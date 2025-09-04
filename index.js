// index.js - Versión Híbrida: Google Sheets + Notificación de Telegram

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { google } = require('googleapis');
const fetch = require('node-fetch');
const FormData = require('form-data');
require('dotenv').config();

// --- INICIO DEL BLOQUE DE CONFIGURACIÓN Y VERIFICACIÓN ---
const { 
    GOOGLE_SHEET_ID, 
    GOOGLE_CREDENTIALS_JSON, 
    TELEGRAM_BOT_TOKEN, 
    TELEGRAM_CHAT_ID 
} = process.env;

if (!GOOGLE_SHEET_ID || !GOOGLE_CREDENTIALS_JSON || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("FATAL ERROR: Faltan una o más variables de entorno (Google o Telegram).");
    process.exit(1);
}

let credentials;
try {
    credentials = JSON.parse(GOOGLE_CREDENTIALS_JSON);
} catch (error) {
    console.error("FATAL ERROR: No se pudo parsear GOOGLE_CREDENTIALS_JSON.", error);
    process.exit(1);
}

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets']; // Ya no necesitamos Drive
const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
});
// --- FIN DEL BLOQUE DE CONFIGURACIÓN ---


const app = express();
const port = process.env.PORT || 4000;

app.use(cors({
  origin: 'https://event-hub-frontend-gamma.vercel.app'
}));

const storage = multer.memoryStorage();
const upload = multer({ storage });


// Endpoint de la API
app.post('/api/submit', upload.single('proof'), async (req, res) => {
    try {
        const {
            name, lastName, email, phone, academicDegree,
            department, institution, career, resellerCode,
            selectedServices, totalAmount, paymentMethod
        } = req.body;
        
        const file = req.file;

        // --- ACCIÓN #1: GUARDAR EN GOOGLE SHEETS (La Fuente de Verdad) ---
        const newRow = [
            name || '', lastName || '', email || '', phone || '', academicDegree || '',
            department || '', institution || '', career || '', resellerCode || '',
            selectedServices, totalAmount || '', paymentMethod || '',
            (paymentMethod === 'qr' && file) ? 'Sí' : 'No', // Columna "Comprobante Enviado"
            new Date().toISOString(),
        ];

        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: 'Respuestas!A:O', // Ajusta el nombre de la hoja y el rango
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [newRow],
            },
        });


        // --- ACCIÓN #2: ENVIAR NOTIFICACIÓN A TELEGRAM (Como Antes) ---
        const submissionData = {
            name, lastName, email, phone, academicDegree, department, institution, career,
            resellerCode, selectedServices: JSON.parse(selectedServices), 
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
            if (!data.ok) throw new Error(`Error de Telegram: ${data.description}`);
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
            if (!data.ok) throw new Error(`Error de Telegram: ${data.description}`);
        }

        // Si ambas acciones tuvieron éxito:
        res.status(200).json({ message: "Registro exitoso en Google Sheets y notificado a Telegram!" });

    } catch (error) {
        console.error("Error al procesar el registro:", error);
        res.status(500).json({ message: "Fallo al procesar el registro." });
    }
});

app.listen(port, () => {
    console.log(`Servidor backend ejecutándose en el puerto ${port}`);
});