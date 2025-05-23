const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const prisma = new PrismaClient();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'seu_segredo_aqui',
    resave: false,
    saveUninitialized: true
}));


app.use(async (req, res, next) => {
    if (!req.session.userId) {
        const randomUsername = `Anônimo${Math.floor(Math.random() * 10000)}`;
        const user = await prisma.user.create({
            data: {
                username: randomUsername
            }
        });
        req.session.userId = user.id;
    }
    
    const user = await prisma.user.findUnique({
        where: { id: req.session.userId }
    });
    req.user = user;
    next();
});

app.get('/', async (req, res) => {
    const servers = await prisma.server.findMany({
        include: {
            channels: true
        }
    });
    res.render('index', { title: 'Início', servers, user: req.user });
});

app.get('/profile', async (req, res) => {
    res.render('profile', { title: 'Perfil', user: req.user });
});

app.post('/profile/username', async (req, res) => {
    const { username } = req.body;
    try {
        await prisma.user.update({
            where: { id: req.session.userId },
            data: { username }
        });
        res.redirect('/profile');
    } catch (error) {
        res.redirect('/profile?error=username_taken');
    }
});

app.get('/servers/new', (req, res) => {
    res.render('new-server', { title: 'Criar Servidor', user: req.user });
});

app.post('/servers', async (req, res) => {
    const { name, description } = req.body;
    try {
        const server = await prisma.server.create({
            data: {
                name,
                description,
                ownerId: req.session.userId
            }
        });
        res.redirect(`/servers/${server.id}`);
    } catch (error) {
        res.redirect('/servers/new?error=server_creation_failed');
    }
});

app.get('/servers/:id', async (req, res) => {
    const server = await prisma.server.findUnique({
        where: { id: parseInt(req.params.id) },
        include: {
            channels: true,
            members: true
        }
    });
    res.render('server', { title: server.name, server, user: req.user });
});

app.post('/servers/:id/channels', async (req, res) => {
    const { name, description } = req.body;
    try {
        await prisma.channel.create({
            data: {
                name,
                description,
                serverId: parseInt(req.params.id)
            }
        });
        res.redirect(`/servers/${req.params.id}`);
    } catch (error) {
        res.redirect(`/servers/${req.params.id}?error=channel_creation_failed`);
    }
});

app.get('/api/channels/:id/messages', async (req, res) => {
    try {
        const messages = await prisma.message.findMany({
            where: {
                channelId: parseInt(req.params.id)
            },
            include: {
                user: true
            },
            orderBy: {
                createdAt: 'asc'
            }
        });
        res.json(messages);
    } catch (error) {
        console.error('Erro ao carregar mensagens:', error);
        res.status(500).json({ error: 'Erro ao carregar mensagens' });
    }
});

io.on('connection', (socket) => {
    console.log('Usuário conectado');

    socket.on('join-channel', async (data) => {
        const channelId = data.channel;
        socket.join(`channel-${channelId}`);
        console.log(`Usuário entrou no canal ${channelId}`);
    });

    socket.on('leave-channel', (data) => {
        const channelId = data.channel;
        socket.leave(`channel-${channelId}`);
        console.log(`Usuário saiu do canal ${channelId}`);
    });

    socket.on('message', async (data) => {
        try {
            const message = await prisma.message.create({
                data: {
                    content: data.text,
                    userId: parseInt(data.userId),
                    channelId: parseInt(data.channelId)
                },
                include: {
                    user: true
                }
            });
            
            io.to(`channel-${data.channelId}`).emit('message', {
                ...message,
                user: message.user.username,
                channelId: message.channelId
            });
        } catch (error) {
            console.error('Erro ao criar mensagem:', error);
        }
    });

    socket.on('disconnect', () => {
        console.log('Usuário desconectado');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
}); 