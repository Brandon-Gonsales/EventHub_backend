// index.js - Versión Simplificada con Códigos Primos

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fetch = require('node-fetch');
const FormData = require('form-data');
require('dotenv').config();

// --- INICIO DEL BLOQUE DE CONFIGURACIÓN Y VERIFICACIÓN ---
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
// --- FIN DEL BLOQUE DE CONFIGURACIÓN ---

const app = express();
const port = process.env.PORT || 4000;

app.use(cors({
  // Asegúrate de que este origen sea el correcto para tu frontend
  origin: 'https://event-hub-frontend-gamma.vercel.app' 
}));

const storage = multer.memoryStorage();
const upload = multer({ storage });

// Genera el ID único de 8 caracteres
function generatePurchaseCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// --- FUNCIONES PARA GENERAR NÚMEROS PRIMOS ---
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
// --- FIN DE FUNCIONES DE NÚMEROS PRIMOS ---

async function extractDataWithGemini(imageBuffer) {
    // ... (Esta función no cambia, sigue siendo útil para el OCR)
    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
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
        // --- ACCIÓN #1: GENERAR CÓDIGOS ---
        const purchaseID = generatePurchaseCode(); // Este es el ID principal
        const primeF1 = generateSixDigitPrime();
        let primeF2 = generateSixDigitPrime();
        while (primeF1 === primeF2) { // Asegurarse de que no sean iguales
            primeF2 = generateSixDigitPrime();
        }
        const productP = primeF1 * primeF2;

        // --- ACCIÓN #2: EXTRAER DATOS SIMPLIFICADOS DEL BODY ---
        const {
            name, email, phone, 
            totalAmount, paymentMethod, eventName // <-- Se añade eventName
        } = req.body;
        
        const file = req.file;
        let ocrData = {};

        // El pago en efectivo no necesita OCR
        if (paymentMethod === 'qr' && file) {
            ocrData = await extractDataWithGemini(file.buffer);
        }

        // --- ACCIÓN #3: PREPARAR LA FILA PARA GOOGLE SHEETS ---
        const newRow = [
            purchaseID,
            name || '',
            email || '',
            phone || '',
            primeF1,
            primeF2,
            productP.toString(),
            totalAmount || '',
            paymentMethod || '',
            (paymentMethod === 'qr' && file) ? 'Sí' : 'No', // Comprobante Enviado
            new Date().toISOString(),
            ocrData.sender || 'N/A',
            ocrData.receiver || 'N/A',
            ocrData.amount || 'N/A',
            ocrData.dateTime || 'N/A',
            '' // Columna "Validado" se deja en blanco
        ];

        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            // Rango ajustado al número de columnas: A hasta P
            range: `${eventName}!A:P`, 
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [newRow],
            },
        });

        // --- ACCIÓN #4: ENVIAR NOTIFICACIÓN A TELEGRAM ---
        const telegramBaseMessage = `
Nuevo Registro para *${eventName}* 🎟️

ID de Compra: *${purchaseID}*

--- Datos del Cliente ---
Nombre: ${name}
Monto Pagado: ${totalAmount} Bs.
Método: ${paymentMethod}

--- Códigos Únicos ---
F1: \`${primeF1}\`
F2: \`${primeF2}\`
P: \`${productP}\`
`;

        const ocrSection = `
--- Verificación OCR ---
Emisor: ${ocrData.sender || 'No detectado'}
Monto (OCR): ${ocrData.amount || 'No detectado'}
`;

        // Añade la sección OCR solo si el pago fue por QR
        const finalTelegramMessage = paymentMethod === 'qr' 
            ? telegramBaseMessage + ocrSection 
            : telegramBaseMessage;
        
        if (paymentMethod === 'qr' && file) {
            const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
            const formData = new FormData();
            formData.append('chat_id', TELEGRAM_CHAT_ID);
            formData.append('caption', finalTelegramMessage);
            formData.append('parse_mode', 'Markdown'); 
            formData.append('photo', file.buffer, { filename: file.originalname });
            await fetch(telegramApiUrl, { method: 'POST', body: formData });
        } else {
            // Para pagos en taquilla, solo se envía texto
            const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
            await fetch(telegramApiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: TELEGRAM_CHAT_ID,
                    text: finalTelegramMessage,
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