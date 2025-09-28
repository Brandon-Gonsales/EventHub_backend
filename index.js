// index.js - Versión con Códigos Primos

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
  origin: 'https://event-hub-frontend-gamma.vercel.app'
}));

const storage = multer.memoryStorage();
const upload = multer({ storage });

function generatePurchaseCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// --- CAMBIO AQUÍ: NUEVAS FUNCIONES PARA GENERAR NÚMEROS PRIMOS ---

/**
 * Verifica si un número es primo.
 * @param {number} num El número a verificar.
 * @returns {boolean} True si es primo, false si no.
 */
function isPrime(num) {
    if (num <= 1) return false;
    if (num <= 3) return true;
    if (num % 2 === 0 || num % 3 === 0) return false;
    for (let i = 5; i * i <= num; i = i + 6) {
        if (num % i === 0 || num % (i + 2) === 0) return false;
    }
    return true;
}

/**
 * Genera un número primo aleatorio de 6 dígitos.
 * @returns {number} Un número primo entre 100000 y 999999.
 */
function generateSixDigitPrime() {
    let primeCandidate;
    do {
        // Genera un número entre 100,000 y 999,999
        primeCandidate = Math.floor(100000 + Math.random() * 900000);
    } while (!isPrime(primeCandidate));
    return primeCandidate;
}
// --- FIN DEL CAMBIO ---

async function extractDataWithGemini(imageBuffer) {
    // ... (Esta función no cambia)
    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const imagePart = { inlineData: { data: imageBuffer.toString("base64"), mimeType: "image/jpeg" } };
        const prompt = `
            Eres un experto extrayendo datos de comprobantes de pago peruanos (Yape, Plin, etc.).
            Analiza la siguiente imagen y extrae la información en formato JSON:
            - "sender": Nombre completo de quien envió el dinero.
            - "receiver": Nombre completo de quien recibió el dinero.
            - "amount": Monto de la transacción como string numérico (ej: "250.00").
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

        // --- CAMBIO AQUÍ: Se reemplaza resellerCode por userProvidedCode ---
        const {
            name, lastName, email, phone, academicDegree,
            department, institution, career, userProvidedCode, // <-- CAMBIADO
            selectedServices, totalAmount, paymentMethod
        } = req.body;
        
        // --- CAMBIO AQUÍ: Se generan los 3 nuevos códigos para cada registro ---
        const primeA = generateSixDigitPrime();
        let primeB = generateSixDigitPrime();
        while (primeA === primeB) { // Nos aseguramos de que no sean el mismo número
            primeB = generateSixDigitPrime();
        }
        const productC = primeA * primeB; // El producto de los dos primos

        const file = req.file;
        let ocrData = {};

        if (paymentMethod === 'qr' && file) {
            ocrData = await extractDataWithGemini(file.buffer);
        }

        // --- CAMBIO AQUÍ: La nueva fila para Google Sheets ---
        const newRow = [
            purchaseCode,
            name || '', lastName || '', email || '', phone || '', academicDegree || '',
            department || '', institution || '', career || '',
            userProvidedCode || '', // El código que el usuario ingresó
            primeA,               // Código Primo A (Generado)
            primeB,               // Código Primo B (Generado)
            productC.toString(),  // Código Producto C (Generado)
            selectedServices, totalAmount || '', paymentMethod || '',
            (paymentMethod === 'qr' && file) ? 'Sí' : 'No',
            new Date().toISOString(),
            ocrData.sender || 'N/A', ocrData.receiver || 'N/A',
            ocrData.amount || 'N/A', ocrData.dateTime || 'N/A',
        ];

        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            // --- ¡IMPORTANTE! El rango se expande para incluir las nuevas columnas ---
            range: 'Respuestas!A:W', 
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [newRow],
            },
        });

        // --- CAMBIO AQUÍ: Mensajes de Telegram actualizados ---
        const telegramCaption = `
Nueva Inscripción Recibida 🚀

Código de Compra: *${purchaseCode}*

--- Datos del Inscrito ---
Nombre: ${name} ${lastName}
Monto Total Pagado: ${totalAmount}
Método de Pago: ${paymentMethod}

--- Códigos de Venta ---
Código Ingresado: \`${userProvidedCode || 'Ninguno'}\`
Primo A (Generado): \`${primeA}\`
Primo B (Generado): \`${primeB}\`
Producto C (Generado): \`${productC}\`

--- Verificación OCR ---
Emisor: ${ocrData.sender || 'No detectado'}
Monto (OCR): ${ocrData.amount || 'No detectado'}
`;

        const telegramTextOnly = `
Nueva Inscripción (Sin QR) 📝

Código de Compra: *${purchaseCode}*

--- Datos del Inscrito ---
Nombre: ${name} ${lastName}
Monto Total Pagado: ${totalAmount}
Método de Pago: ${paymentMethod}

--- Códigos de Venta ---
Código Ingresado: \`${userProvidedCode || 'Ninguno'}\`
Primo A (Generado): \`${primeA}\`
Primo B (Generado): \`${primeB}\`
Producto C (Generado): \`${productC}\`
`;
        
        if (paymentMethod === 'qr' && file) {
            const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
            const formData = new FormData();
            formData.append('chat_id', TELEGRAM_CHAT_ID);
            formData.append('caption', telegramCaption);
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
                    text: telegramTextOnly,
                    parse_mode: 'Markdown',
                }),
            });
        }

        res.status(200).json({ message: "Registro con códigos primos exitoso!" });

    } catch (error) {
        console.error("Error al procesar el registro:", error);
        res.status(500).json({ message: "Fallo al procesar el registro." });
    }
});

app.listen(port, () => {
    console.log(`Servidor backend ejecutándose en el puerto ${port}`);
});