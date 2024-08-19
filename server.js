const express = require('express');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const bwipjs = require('bwip-js');
const archiver = require('archiver');

// Setup Express app
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.set('view engine', 'ejs');

// Setup storage for multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
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
    res.render('index');
});

// Endpoint to handle barcode submission and generate PDF
app.post('/submit', upload.array('barcodeImages'), async (req, res) => {
    const { barcodes, stockCounts } = req.body;
    const barcodeImages = req.files;

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

    // Split barcodes and stock counts by line and filter out empty lines
    const barcodeList = barcodes.split('\n').filter(b => b.trim() !== '');
    const stockCountList = stockCounts.split('\n').filter(c => c.trim() !== '');

    for (const [index, barcode] of barcodeList.entries()) {
        try {
            const barcodeImage = await generateBarcodeImage(barcode.trim(), barcode.trim());
            const stockCount = stockCountList[index] || 'N/A';

            doc.moveDown(1);  // Move down before adding each new barcode

            // Display barcode text and stock count
            doc.fontSize(14).text(`Barcode: ${barcode}\nStock Count: ${stockCount}`, {
                align: 'left',
                continued: true
            });

            // Display barcode image on the right-hand side
            const imageY = doc.y;
            doc.image(barcodeImage, doc.page.width - 250, imageY, {
                fit: [200, 100],
                align: 'right',
                valign: 'center'
            });

            // Check if there is an uploaded image for this barcode
            if (barcodeImages[index]) {
                doc.moveDown(1);
                doc.fontSize(14).text('Associated Image:', {
                    align: 'left',
                });

                const userImagePath = path.join(__dirname, 'uploads', `${barcode.trim()}-user${path.extname(barcodeImages[index].originalname)}`);
                fs.renameSync(barcodeImages[index].path, userImagePath);

                doc.image(userImagePath, doc.page.width - 250, doc.y, {
                    fit: [200, 150],
                    align: 'right',
                    valign: 'center'
                });
            }

            doc.moveDown(3);  // Increase space after each image to prevent overlap
        } catch (error) {
            console.error(`Error generating barcode for ${barcode}:`, error);
        }
    }

    // Finalize the PDF
    doc.end();

    // Ensure the PDF is fully written before attempting to download
    writeStream.on('finish', () => {
        res.download(pdfPath, 'barcodes.pdf', (err) => {
            if (err) {
                console.error('Error sending PDF:', err);
                res.status(500).send('Error generating PDF.');
            } else {
                // Optionally clean up the generated PDF file
                fs.unlinkSync(pdfPath);
            }
        });
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

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
