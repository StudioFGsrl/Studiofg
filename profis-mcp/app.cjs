// File di avvio per hosting condivisi con "Setup Node.js App" (cPanel / Phusion Passenger),
// che caricano l'applicazione con require(): il server vero è un modulo ES in dist/.
import("./dist/index.js");
