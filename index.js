// index.js - Versión con Códigos Primos y Verificación de Duplicados

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
const sheets = google.sheets({ version: 'v4', auth });
// --- Fin del bloque de configuración ---
const app = express();
const port = process.env.PORT || 4000;

// --- INICIO DEL CAMBIO: CONFIGURACIÓN DE CORS MEJORADA ---

// Lista de los orígenes (dominios) que tienen permiso para hacer peticiones a tu backend.
const allowedOrigins = [
  'https://event-hub-frontend-gamma.vercel.app', // Tu dominio de producción en Vercel
  'http://localhost:3000',                      // Para pruebas locales (si usas create-react-app)
  'http://localhost:5173',
  'https://event-hub-frontend-git-master-brandon-gonsales-projects.vercel.app'                       // Para pruebas locales (si usas Vite)
];
//prueba
app.use(cors({
  origin: function (origin, callback) {
    // Si la petición no tiene un 'origin' (ej. una app móvil o Postman), la permitimos.
    if (!origin) return callback(null, true);
    
    // Si el 'origin' de la petición está en nuestra lista de dominios permitidos, la permitimos.
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'La política de CORS para este sitio no permite el acceso desde el origen especificado.';
      return callback(new Error(msg), false);
    }
    
    return callback(null, true);
  }
}));

// --- FIN DEL CAMBIO ---

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


// *****************************************************************************
// --- INICIO DEL CAMBIO #1: NUEVA FUNCIÓN PARA LEER EL GOOGLE SHEET ---
// *****************************************************************************

/**
 * Obtiene todos los pares de códigos primos ya guardados en el Google Sheet.
 * @returns {Promise<Set<string>>} Un Set con los pares existentes en formato "primoMenor-primoMayor".
 */
async function getExistingPrimePairs() {
    try {
        //const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            // ¡IMPORTANTE! Asume que los primos están en las columnas K y L.
            // Si cambias las columnas, debes actualizar este rango.
            range: 'Respuestas!H:I', 
        });

        const rows = response.data.values;
        const existingPairs = new Set();

        if (rows && rows.length) {
            // Empezamos en 1 para saltarnos la fila de cabecera
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (row[0] && row[1]) {
                    // Ordenamos los números para que el par (A, B) sea igual que (B, A)
                    const pair = [parseInt(row[0]), parseInt(row[1])].sort((a, b) => a - b);
                    existingPairs.add(`${pair[0]}-${pair[1]}`);
                }
            }
        }
        console.log(`Se encontraron ${existingPairs.size} pares de primos existentes.`);
        return existingPairs;
    } catch (error) {
        console.error("Advertencia: No se pudieron obtener los pares de primos existentes. Se procederá sin verificación.", error.message);
        // Si falla (ej. la hoja es nueva), devolvemos un Set vacío para que la app no se caiga.
        return new Set();
    }
}

// *****************************************************************************
// --- FIN DEL CAMBIO #1 ---
// *****************************************************************************


// --- Función de Gemini (sin cambios) ---
async function extractDataWithGemini(imageBuffer) {
    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
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
        return { sender: '404', receiver: '404', amount: '404', dateTime: '404' };
    }
}

app.post('/api/submit', upload.single('proof'), async (req, res) => {
    try {
        const purchaseCode = generatePurchaseCode();

        const {
            name, lastName, email, phone, academicDegree,
            department, institution, career, userProvidedCode,
            selectedServices, totalAmount, paymentMethod
        } = req.body;
        

        // *****************************************************************************
        // --- INICIO DEL CAMBIO #2: LÓGICA DE GENERACIÓN DE PRIMOS ACTUALIZADA ---
        // *****************************************************************************

        const existingPairs = await getExistingPrimePairs();
        let primeA, primeB, pairKey;
        let attempts = 0;

        do {
            primeA = generateSixDigitPrime();
            primeB = generateSixDigitPrime();
            
            // Creamos una clave única y ordenada para el par
            const sortedPair = [primeA, primeB].sort((a, b) => a - b);
            pairKey = `${sortedPair[0]}-${sortedPair[1]}`;
            
            attempts++;
            if (attempts > 1) {
                console.log(`Intento #${attempts}: El par ${pairKey} ya existía. Generando uno nuevo...`);
            }

        // Repetimos si A y B son iguales O si el par ya existe en nuestro Set
        } while (primeA === primeB || existingPairs.has(pairKey));

        console.log(`Par único encontrado: ${pairKey} en ${attempts} intento(s).`);
        const productC = primeA * primeB;

        // *****************************************************************************
        // --- FIN DEL CAMBIO #2 ---
        // *****************************************************************************


        const file = req.file;
        let ocrData = {};

        if (paymentMethod === 'qr' && file) {
            ocrData = await extractDataWithGemini(file.buffer);
        }

        const newRow = [
            /* A - ID */ purchaseCode, // Tu `purchaseCode` va en la columna ID
            /* B - NOMBRE */ `${name || ''} ${lastName || ''}`.trim(), // Nombre + Apellido
            /* C - TELEFONO */ phone || '', // Teléfono ahora está en la columna C
            /* D - NAME */ name || '', // Si quieres el nombre por separado, va aquí
            /* E - PHONE */ '', // Dejamos E vacía, ya que el teléfono ya fue puesto
            /* F - EMAIL */ email || '', // Email va en la columna F
            /* G - CODIGO ING */ userProvidedCode || '', // Asumo que este campo era el que querías guardar aquí

            // --- Bloque de Códigos Primos ---
            /* H - F1 */ primeA, // Primo A (F1)
            /* I - F2 */ primeB, // Primo B (F2)
            /* J - P */ productC.toString(), // Producto C (P)

            // --- Bloque de Pago ---
            /* K - TOTAL */ totalAmount || '', // Monto Total
            /* L - PAGO */ paymentMethod || '', // Método de Pago
            /* M - COMPROBANTE */ (paymentMethod === 'qr' && file) ? 'Sí' : 'No', // Comprobante Enviado
            /* N - HORA */ new Date().toISOString(), // Hora de Registro

            // --- Bloque de Datos OCR ---
            /* O - OCR Nombre Emisor */ ocrData.sender || 'N/A',
            /* P - OCR Nombre Receptor */ ocrData.receiver || 'N/A',
            /* Q - OCR Monto */ ocrData.amount || 'N/A',
            /* R - OCR Fecha/Hora */ ocrData.dateTime || 'N/A',

            // NOTA: Tu hoja actual termina en R. Si deseas agregar más, aquí irían:
            // /* S */ '0' // Si tuvieras una columna 'Validado' o similar más allá de R
        ];

        await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: 'Respuestas!A:R', // AJUSTA EL RANGO para que coincida con los datos enviados
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [newRow],
            },
        });

        // El resto del código para Telegram y la respuesta no necesita cambios.
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

        res.status(200).json({ message: "Registro con códigos primos único exitoso!" });

    } catch (error) {
        console.error("Error al procesar el registro:", error);
        res.status(500).json({ message: "Fallo al procesar el registro." });
    }
});

app.listen(port, () => {
    console.log(`Servidor backend ejecutándose en el puerto ${port}`);
});