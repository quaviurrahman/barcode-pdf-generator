const express = require('express');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const bwipjs = require('bwip-js');
const archiver = require('archiver');

// Setup Express app
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({ secret: 'barcodeSecret', resave: false, saveUninitialized: true }));
app.set('view engine', 'ejs');

// Setup storage for multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const barcode = req.body.barcode.trim(); // Get the barcode from the form
        const ext = path.extname(file.originalname); // Get the original file extension
        cb(null, `${barcode}${ext}`); // Set the filename as the barcode text with the original extension
    }
});

const upload = multer({ storage: storage });

// Serve static files from the "public" directory
app.use(express.static('public'));

// Ensure the pdfs directory exists
if (!fs.existsSync('pdfs')) {
    fs.mkdirSync('pdfs');
}

// Ensure the uploads directory exists
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Homepage route
app.get('/', (req, res) => {
    if (!req.session.entries) {
        req.session.entries = [];
    }
    res.render('index', { entries: req.session.entries });
});

// Endpoint to handle barcode, stock count, and image submission
app.post('/add-entry', upload.single('barcodeImage'), (req, res) => {
    const { barcode, stockCount } = req.body;
    const barcodeImage = req.file ? req.file.path : null;

    req.session.entries.push({
        barcode,
        stockCount,
        barcodeImage
    });

    res.redirect('/');
});

// Endpoint to end input and generate PDF and ZIP
app.post('/generate', async (req, res) => {
    const entries = req.session.entries;

    // Create PDF document
    const doc = new PDFDocument({ margin: 30 });
    const pdfPath = path.join(__dirname, `pdfs/barcodes-${Date.now()}.pdf`);
    const writeStream = fs.createWriteStream(pdfPath);

    // Begin piping the PDF data to a file
    doc.pipe(writeStream);

    // Add title to the PDF
    doc.fontSize(25).text('Barcodes List', {
        align: 'center'
    });

    const zipFilePath = path.join(__dirname, `pdfs/barcode-images-${Date.now()}.zip`);
    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver('zip', {
        zlib: { level: 9 }
    });

    output.on('close', () => {
        console.log(`ZIP file created with ${archive.pointer()} total bytes`);
    });

    archive.on('error', (err) => {
        throw err;
    });

    archive.pipe(output);

    for (const entry of entries) {
        try {
            const barcodeImage = await generateBarcodeImage(entry.barcode.trim(), entry.barcode.trim());
            const stockCount = entry.stockCount || 'N/A';

            doc.moveDown(1);  // Move down before adding each new barcode

            // Display barcode text and stock count
            doc.fontSize(14).text(`Barcode: ${entry.barcode}\nStock Count: ${stockCount}`, {
                align: 'left',
                continued: true
            });

            // Display barcode image on the left-hand side
            const imageY = doc.y;
            doc.image(barcodeImage, { fit: [200, 100], align: 'left', valign: 'center' });

            // Check if there is an uploaded image for this barcode
            if (entry.barcodeImage) {
                const rightImageX = doc.page.width - 230;
                doc.image(entry.barcodeImage, rightImageX, imageY, { fit: [200, 150], align: 'right', valign: 'center' });
                // Add only the uploaded images to the ZIP file
                archive.file(entry.barcodeImage, { name: path.basename(entry.barcodeImage) });
            }

            doc.moveDown(3);  // Increase space after each set of images to prevent overlap
        } catch (error) {
            console.error(`Error generating barcode for ${entry.barcode}:`, error);
        }
    }

    doc.end();
    archive.finalize();

    // Ensure the PDF is fully written before allowing download
    writeStream.on('finish', () => {
        res.render('download', { pdfPath: `/pdfs/${path.basename(pdfPath)}`, zipPath: `/pdfs/${path.basename(zipFilePath)}` });
        req.session.entries = []; // Clear session entries after generating files
    });

    writeStream.on('error', (err) => {
        console.error('Error writing PDF:', err);
        res.status(500).send('Error generating PDF.');
    });
});

// Function to generate barcode image and save it with a specific name
function generateBarcodeImage(barcode, filename) {
    return new Promise((resolve, reject) => {
        bwipjs.toBuffer({
            bcid: 'code128',       // Barcode type
            text: barcode,         // Text to encode
            scale: 3,              // 3x scaling factor
            height: 10,            // Bar height, in millimeters
            includetext: true,     // Show human-readable text
            textxalign: 'center',  // Align text to the center
        }, (err, png) => {
            if (err) {
                return reject(err);
            }
            const filePath = path.join(__dirname, 'uploads', `${filename}.png`);
            fs.writeFile(filePath, png, (err) => {
                if (err) {
                    return reject(err);
                }
                resolve(filePath);
            });
        });
    });
}

// Serve PDF and ZIP files statically
app.use('/pdfs', express.static(path.join(__dirname, 'pdfs')));

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
