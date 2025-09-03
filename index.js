// Para ejecutar este servidor de backend:
// 1. Navega a la carpeta `backend` en tu terminal: `cd backend`
// 2. Instala las dependencias: `npm install`
// 3. Crea un archivo `.env` en esta carpeta con tus credenciales de Telegram.
// 4. Inicia el servidor: `npm start`

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fetch = require('node-fetch');
const FormData = require('form-data');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 4000;

const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;

// Usa CORS para permitir solicitudes desde tu frontend
// En una aplicación real, restringirías esto al dominio de tu frontend
app.use(cors());

// Configuración de Multer para manejar subidas de archivos en memoria
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Endpoint de la API para el envío del formulario
app.post('/api/submit', upload.single('proof'), async (req, res) => {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error("Las credenciales de Telegram no están configuradas en el archivo .env.");
        return res.status(500).json({ message: "Error de configuración del servidor." });
    }

    try {
        const {
            name, lastName, email, phone, academicDegree,
            department, institution, career, resellerCode,
            selectedServices, totalAmount, paymentMethod
        } = req.body;
        
        const file = req.file;

        const submissionData = {
            name, lastName, email, phone, academicDegree, department,
            institution, career, resellerCode,
            selectedServices: JSON.parse(selectedServices), // Fue enviado como string
            totalAmount, paymentMethod,
        };
        const jsonDataString = `\`\`\`json\n${JSON.stringify(submissionData, null, 2)}\n\`\`\``;

        if (paymentMethod === 'qr' && file) {
            const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
            const formData = new FormData();
            formData.append('chat_id', TELEGRAM_CHAT_ID);
            formData.append('caption', jsonDataString);
            formData.append('parse_mode', 'MarkdownV2');
            formData.append('photo', file.buffer, { filename: file.originalname });

            const response = await fetch(telegramApiUrl, { method: 'POST', body: formData });
            const data = await response.json();
            if (!data.ok) throw new Error(data.description);
        } else {
            const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
            const response = await fetch(telegramApiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: TELEGRAM_CHAT_ID,
                    text: jsonDataString,
                    parse_mode: 'MarkdownV2',
                }),
            });
            const data = await response.json();
            if (!data.ok) throw new Error(data.description);
        }

        res.status(200).json({ message: "¡Registro exitoso!" });
    } catch (error) {
        console.error("Error al enviar datos a Telegram:", error);
        res.status(500).json({ message: "Fallo al enviar el registro." });
    }
});

app.listen(port, () => {
    console.log(`Servidor backend ejecutándose en http://localhost:${port}`);
});
