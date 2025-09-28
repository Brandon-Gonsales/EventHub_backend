// index.js - Versión con Códigos Primos (Corregida y Simplificada)

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

// --- Función de Gemini (sin cambios) ---
async function extractDataWithGemini(imageBuffer) {
    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
        const imagePart = { inlineData: { data: imageBuffer.toString("base64"), mimeType: "image/jpeg" } };
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
        const purchaseCode = generatePurchaseCode(); // Este es el ID

        // --- CAMBIO #1: Solo extraemos los campos necesarios del body ---
        const {
            name, email, phone, eventName,
            totalAmount, paymentMethod
        } = req.body;
        
        // Se generan los 3 códigos F1, F2 y P
        const primeF1 = generateSixDigitPrime();
        let primeF2 = generateSixDigitPrime();
        while (primeF1 === primeF2) {
            primeF2 = generateSixDigitPrime();
        }
        const productP = primeF1 * primeF2;

        const file = req.file;
        let ocrData = {};

        if (paymentMethod === 'qr' && file) {
            ocrData = await extractDataWithGemini(file.buffer);
        }

        // --- CAMBIO #2: Construimos la fila `newRow` con la estructura exacta que necesitas ---
        const newRow = [
            purchaseCode,         // ID
            name || '',           // NOMBRE
            email || '',          // CORREO
            phone || '',          // TELEFONO
            primeF1,              // F1
            primeF2,              // F2
            productP.toString(),  // P
            totalAmount || '',    // TOTAL
            paymentMethod || '',  // PAGO
            (paymentMethod === 'qr' && file) ? 'Sí' : 'No', // COMPROBANTE ENVIADO
            new Date().toISOString(), // HORA
            ocrData.sender || 'N/A',   // OCR Nombre Emisor
            ocrData.receiver || 'N/A', // OCR Nombre Receptor
            ocrData.amount || 'N/A',   // OCR Monto
            ocrData.dateTime || 'N/A', // OCR Fecha/Hora
            ''                    // Validado (en blanco)
        ];

        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            // --- CAMBIO #3: El rango se ajusta a 16 columnas (A:P) y usa el nombre del evento ---
            range: `${eventName || 'Respuestas'}!A:P`, 
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [newRow],
            },
        });

        // --- CAMBIO #4: Mensajes de Telegram simplificados ---
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
        
        // Unimos el mensaje base con la sección de OCR si existe
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
                    text: finalCaption, // Usamos el mismo mensaje simplificado
                    parse_mode: 'Markdown',
                }),
            });
        }

        res.status(200).json({ message: "Registro simplificado exitoso!" });

    } catch (error) {
        console.error("Error al procesar el registro:", error);
        res.status(500).json({ message: "Fallo al procesar el registro." });
    }
});

app.listen(port, () => {
    console.log(`Servidor backend ejecutándose en el puerto ${port}`);
});