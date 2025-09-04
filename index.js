// index.js modificado para Google Sheets

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { google } = require('googleapis');
const path = require('path');
const stream = require('stream');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 4000;

// Configuración de Google
const { GOOGLE_SHEET_ID } = process.env;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'];

// 1. Parsea las credenciales desde la variable de entorno (que es un string)
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);

// 2. Usa el objeto de credenciales directamente
const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
});

// Usa CORS
app.use(cors({
  origin: 'https://event-hub-frontend-gamma.vercel.app'
}));

// Configuración de Multer en memoria
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Función para subir el archivo a Google Drive y obtener el enlace
async function uploadToDrive(fileObject) {
    const bufferStream = new stream.PassThrough();
    bufferStream.end(fileObject.buffer);

    const drive = google.drive({ version: 'v3', auth });
    const { data } = await drive.files.create({
        media: {
            mimeType: fileObject.mimetype,
            body: bufferStream,
        },
        requestBody: {
            name: fileObject.originalname,
            parents: [], // Puedes especificar una carpeta de Drive aquí si quieres
        },
        fields: 'id,webViewLink',
    });

    // Hacer el archivo público para que el enlace funcione
    await drive.permissions.create({
        fileId: data.id,
        requestBody: {
            role: 'reader',
            type: 'anyone',
        },
    });

    return data.webViewLink;
}


// Endpoint de la API
app.post('/api/submit', upload.single('proof'), async (req, res) => {
    if (!GOOGLE_SHEET_ID) {
        console.error("El ID de Google Sheet no está configurado en el archivo .env.");
        return res.status(500).json({ message: "Error de configuración del servidor." });
    }

    try {
        const {
            name, lastName, email, phone, academicDegree,
            department, institution, career, resellerCode,
            selectedServices, totalAmount, paymentMethod
        } = req.body;
        
        const file = req.file;
        let proofUrl = 'N/A';

        // 1. Si hay un archivo de comprobante, súbelo a Google Drive
        if (paymentMethod === 'qr' && file) {
            proofUrl = await uploadToDrive(file);
        }

        // 2. Prepara la fila de datos para la hoja de cálculo
        const newRow = [
            name || '',
            lastName || '',
            email || '',
            phone || '',
            academicDegree || '',
            department || '',
            institution || '',
            career || '',
            resellerCode || '',
            selectedServices, // Ya no necesitas parsearlo si el frontend lo envía bien
            totalAmount || '',
            paymentMethod || '',
            proofUrl,
            new Date().toISOString(), // Añadimos una marca de tiempo
        ];

        // 3. Escribe la nueva fila en Google Sheets
        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: 'Sheet1!A:N', // Ajusta 'Sheet1' al nombre de tu hoja y el rango a tus columnas
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [newRow],
            },
        });

        res.status(200).json({ message: "¡Registro exitoso en Google Sheets!" });

    } catch (error) {
        console.error("Error al enviar datos a Google Sheets:", error);
        res.status(500).json({ message: "Fallo al enviar el registro." });
    }
});

app.listen(port, () => {
    console.log(`Servidor backend ejecutándose en http://localhost:${port}`);
});