// index.js - Versión Final: Sheets + Telegram + OCR con GEMINI

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { google } = require('googleapis');
const { VertexAI } = require('@google-cloud/vertexai'); // <-- NUEVA LIBRERÍA
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

// ... (El bloque de verificación de variables de entorno es el mismo) ...
if (!GOOGLE_SHEET_ID || !GOOGLE_CREDENTIALS_JSON || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("FATAL ERROR: Faltan una o más variables de entorno.");
    process.exit(1);
}
let credentials;
try {
    credentials = JSON.parse(GOOGLE_CREDENTIALS_JSON);
} catch (error) {
    console.error("FATAL ERROR: No se pudo parsear GOOGLE_CREDENTIALS_JSON.", error);
    process.exit(1);
}

// ¡CAMBIAMOS EL SCOPE! Vertex AI usa el scope general de cloud-platform.
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/cloud-platform'];
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


// --- NUEVA FUNCIÓN INTELIGENTE CON GEMINI ---
async function extractDataWithGemini(imageBuffer) {
    try {
        const vertex_ai = new VertexAI({
            project: credentials.project_id,
            location: 'us-central1'
        });
        const model = 'gemini-pro-vision'; // Modelo multimodal

        const generativeModel = vertex_ai.preview.getGenerativeModel({ model });

        const imagePart = {
            inlineData: {
                data: imageBuffer.toString('base64'),
                mimeType: 'image/jpeg', // O 'image/png'
            },
        };

        // EL PROMPT: Aquí está la magia. Le decimos a Gemini exactamente qué hacer.
        const prompt = `
            Eres un experto extrayendo datos de comprobantes de pago peruanos (Yape, Plin, etc.).
            Analiza la siguiente imagen de un comprobante de pago y extrae la siguiente información en formato JSON:
            - "sender": El nombre completo de la persona que envió el dinero.
            - "receiver": El nombre completo de la persona que recibió el dinero.
            - "amount": El monto de la transacción, como un string numérico (ej: "250.00").
            - "dateTime": La fecha y hora de la transacción en el formato más completo posible que encuentres.

            Si no puedes encontrar un campo, usa el valor "No encontrado".
            Responde únicamente con el objeto JSON y nada más.
        `;

        const request = {
            contents: [{ role: 'user', parts: [imagePart, { text: prompt }] }],
        };

        const responseStream = await generativeModel.generateContentStream(request);
        const aggregatedResponse = await responseStream.response;
        const fullTextResponse = aggregatedResponse.candidates[0].content.parts[0].text;

        // Limpiamos la respuesta para asegurarnos de que es solo el JSON
        const jsonResponse = fullTextResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonResponse);

    } catch (error) {
        console.error("Error en la API de Gemini:", error);
        return {
            sender: 'Error Gemini',
            receiver: 'Error Gemini',
            amount: 'Error Gemini',
            dateTime: 'Error Gemini',
        };
    }
}


// Endpoint de la API
app.post('/api/submit', upload.single('proof'), async (req, res) => {
    try {
        const {
            name, lastName, email, phone, academicDegree,
            department, institution, career, resellerCode,
            selectedServices, totalAmount, paymentMethod
        } = req.body;
        
        const file = req.file;
        let ocrData = {};

        // --- ACCIÓN #0: EXTRAER DATOS CON GEMINI SI HAY IMAGEN ---
        if (paymentMethod === 'qr' && file) {
            ocrData = await extractDataWithGemini(file.buffer);
        }

        // --- ACCIÓN #1: GUARDAR TODO EN GOOGLE SHEETS ---
        const newRow = [
            name || '', lastName || '', email || '', phone || '', academicDegree || '',
            department || '', institution || '', career || '', resellerCode || '',
            selectedServices, totalAmount || '', paymentMethod || '',
            (paymentMethod === 'qr' && file) ? 'Sí' : 'No',
            new Date().toISOString(),
            // Nuevas columnas con datos de Gemini
            ocrData.sender || 'N/A',
            ocrData.receiver || 'N/A',
            ocrData.amount || 'N/A',
            ocrData.dateTime || 'N/A',
        ];

        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: 'Respuestas!A:S', // Asegúrate de que el rango sea correcto
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [newRow],
            },
        });


        // --- ACCIÓN #2: ENVIAR NOTIFICACIÓN A TELEGRAM (con datos de Gemini) ---
        const submissionData = {
            Formulario: { name, lastName, email, phone },
            Comprobante_OCR: { ...ocrData },
            Monto_Total: totalAmount,
        };
        const jsonDataString = `\`\`\`json\n${JSON.stringify(submissionData, null, 2)}\n\`\`\``;

        // ... (El resto del código de envío a Telegram es el mismo) ...
        if (paymentMethod === 'qr' && file) {
            const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
            const formData = new FormData();
            formData.append('chat_id', TELEGRAM_CHAT_ID);
            formData.append('caption', jsonDataString);
            formData.append('parse_mode', 'MarkdownV2');
            formData.append('photo', file.buffer, { filename: file.originalname });
            await fetch(telegramApiUrl, { method: 'POST', body: formData });
        } else {
             // (código para enviar solo texto si no hay QR)
        }

        res.status(200).json({ message: "Registro y OCR con Gemini exitosos!" });

    } catch (error) {
        console.error("Error al procesar el registro:", error);
        res.status(500).json({ message: "Fallo al procesar el registro." });
    }
});

app.listen(port, () => {
    console.log(`Servidor backend ejecutándose en el puerto ${port}`);
});