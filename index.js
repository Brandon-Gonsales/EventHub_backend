// index.js - Versión Corregida

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fetch = require('node-fetch');
const FormData = require('form-data');
require('dotenv').config();

// --- Bloque de configuración (sin cambios) ---
const { 
    GOOGLE_SHEET_ID, 
    GOOGLE_CREDENTIALS_JSON, 
    TELEGRAM_BOT_TOKEN, 
    TELEGRAM_CHAT_ID,
    GEMINI_API_KEY   
} = process.env;

if (!GOOGLE_SHEET_ID || !GOOGLE_CREDENTIALS_JSON || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !GEMINI_API_KEY) {
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
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
// --- Fin del bloque de configuración ---

const app = express();
const port = process.env.PORT || 4000;

app.use(cors({
  origin: 'https://event-hub-frontend-gamma.vercel.app'
}));

const storage = multer.memoryStorage();
const upload = multer({ storage });

// --- Funciones de generación de códigos (sin cambios) ---
function generatePurchaseCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
function isPrime(num) {
    if (num <= 1) return false;
    if (num <= 3) return true;
    if (num % 2 === 0 || num % 3 === 0) return false;
    for (let i = 5; i * i <= num; i = i + 6) {
        if (num % i === 0 || num % (i + 2) === 0) return false;
    }
    return true;
}
function generateSixDigitPrime() {
    let primeCandidate;
    do {
        primeCandidate = Math.floor(100000 + Math.random() * 900000);
    } while (!isPrime(primeCandidate));
    return primeCandidate;
}
// --- Fin de funciones ---

// --- CAMBIO #1: La función ahora recibe el objeto 'file' completo para usar su mimetype ---
async function extractDataWithGemini(file) {
    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        
        // Usamos el buffer del archivo y su mimetype dinámico
        const imagePart = { 
            inlineData: { 
                data: file.buffer.toString("base64"), 
                mimeType: file.mimetype // <-- CAMBIO AQUÍ: Usamos el mimetype real del archivo
            } 
        };

        const prompt = `
            Eres un experto extrayendo datos de comprobantes de pago de Bolivia (QR Simple).
            Analiza la siguiente imagen y extrae la información en formato JSON:
            - "sender": Nombre completo de quien envió el dinero.
            - "receiver": Nombre completo de quien recibió el dinero.
            - "amount": Monto de la transacción como string numérico (ej: "70.00").
            - "dateTime": Fecha y hora de la transacción.
            Si no encuentras un campo, usa el valor "No encontrado".
            Responde únicamente con el objeto JSON.`;
        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const text = response.text();
        const jsonResponse = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonResponse);
    } catch (error) {
        console.error("Error en la API de Gemini (AI Studio):", error);
        return { sender: 'Error Gemini', receiver: 'Error Gemini', amount: 'Error Gemini', dateTime: 'Error Gemini' };
    }
}

app.post('/api/submit', upload.single('proof'), async (req, res) => {
    try {
        const purchaseCode = generatePurchaseCode();

        const {
            name, email, phone, eventName,
            totalAmount, paymentMethod
        } = req.body;
        
        const primeF1 = generateSixDigitPrime();
        let primeF2 = generateSixDigitPrime();
        while (primeF1 === primeF2) {
            primeF2 = generateSixDigitPrime();
        }
        const productP = primeF1 * primeF2;

        const file = req.file;
        let ocrData = {};

        if (paymentMethod === 'qr' && file) {
            // Pasamos el objeto 'file' completo a la función
            ocrData = await extractDataWithGemini(file); // <-- CAMBIO AQUÍ
        }

        const newRow = [
            purchaseCode, name || '', email || '', phone || '',
            primeF1, primeF2, productP.toString(),
            totalAmount || '', paymentMethod || '',
            (paymentMethod === 'qr' && file) ? 'Sí' : 'No',
            new Date().toISOString(),
            ocrData.sender || 'N/A', ocrData.receiver || 'N/A',
            ocrData.amount || 'N/A', ocrData.dateTime || 'N/A',
            ''
        ];

        const sheetName = eventName || 'Respuestas';
        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            // --- CAMBIO #2: El nombre de la hoja ahora está entre comillas simples ---
            range: `'${sheetName}'!A:P`, // <-- CAMBIO AQUÍ
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [newRow],
            },
        });

        const telegramMessage = `
Nuevo Registro para *${eventName}* 🎟️

ID: *${purchaseCode}*
Nombre: ${name}
Monto: ${totalAmount} Bs.
Método: ${paymentMethod}
`;
        const ocrSection = `
--- OCR del Comprobante ---
Emisor: ${ocrData.sender || 'N/A'}
Monto: ${ocrData.amount || 'N/A'}
`;
        const finalCaption = telegramMessage + ( (paymentMethod === 'qr' && file) ? ocrSection : '' );

        if (paymentMethod === 'qr' && file) {
            const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
            const formData = new FormData();
            formData.append('chat_id', TELEGRAM_CHAT_ID);
            formData.append('caption', finalCaption);
            formData.append('parse_mode', 'Markdown'); 
            formData.append('photo', file.buffer, { filename: file.originalname });
            await fetch(telegramApiUrl, { method: 'POST', body: formData });
        } else {
             const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
            await fetch(telegramApiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: TELEGRAM_CHAT_ID,
                    text: finalCaption,
                    parse_mode: 'Markdown',
                }),
            });
        }

        res.status(200).json({ message: "Registro exitoso!" });

    } catch (error) {
        console.error("Error al procesar el registro:", error);
        res.status(500).json({ message: "Fallo al procesar el registro." });
    }
});

app.listen(port, () => {
    console.log(`Servidor backend ejecutándose en el puerto ${port}`);
});