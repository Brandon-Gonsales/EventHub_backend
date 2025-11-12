# Usa una imagen oficial y ligera de Node.js
FROM node:18-slim

# Establece el directorio de trabajo dentro del contenedor
WORKDIR /usr/src/app

# Copia los archivos de dependencias
COPY package*.json ./

# Instala solo las dependencias de producción para que sea más rápido y seguro
RUN npm install --only=production

# Copia el resto del código de tu backend
COPY . .

# Indica a Cloud Run que tu app usará el puerto que él le asigne
# No necesitas cambiar tu código, pero es una buena práctica exponer un puerto por defecto
EXPOSE 8080

# El comando que se ejecutará para iniciar tu app
CMD [ "npm", "start" ]