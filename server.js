const express = require('express');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const bwipjs = require('bwip-js');

// Setup Express app
const app = express();
const port = process.env.PORT || 3000;
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

// Endpoint to handle barcode submission
app.post('/submit', upload.array('barcodeImages'), async (req, res) => {
    const { barcodes } = req.body;
    const barcodeImages = req.files;

    // Create PDF document
    const doc = new PDFDocument({ margin: 30 });
    const pdfPath = `./pdfs/barcodes-${Date.now()}.pdf`;

    // Begin piping the PDF data to a file
    doc.pipe(fs.createWriteStream(pdfPath));

    // Add title to the PDF
    doc.fontSize(25).text('Barcodes List', {
        align: 'center'
    });

    // Split barcodes by line and filter out empty lines
    const barcodeList = barcodes.split('\n').filter(b => b.trim() !== '');

    for (const [index, barcode] of barcodeList.entries()) {
        try {
            const barcodeImage = await generateBarcodeImage(barcode.trim());

            doc.moveDown(5);  // Move down before adding each new barcode
            doc.fontSize(14).text(`Barcode: ${barcode}`, {
                align: 'left',
            });

            doc.image(barcodeImage, {
                fit: [250, 100],
                align: 'left',
                valign: 'center'
            });

            // Check if there is an uploaded image for this barcode
            if (barcodeImages[index]) {
                doc.moveDown(6);
                doc.fontSize(14).text('Associated Image:', {
                    align: 'left',
                });

                doc.image(barcodeImages[index].path, {
                    fit: [250, 150],
                    align: 'left',
                    valign: 'center'
                });

                // Clean up the uploaded image file after use
                fs.unlinkSync(barcodeImages[index].path);
            }

            doc.moveDown(5);  // Increase space after each image to prevent overlap

            // Clean up generated barcode image file
            fs.unlinkSync(barcodeImage);
        } catch (error) {
            console.error(`Error generating barcode for ${barcode}:`, error);
        }
    }

    // Finalize the PDF
    doc.end();

    // Send the generated PDF as a response to the client
    doc.on('finish', () => {
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
});

// Function to generate barcode image
function generateBarcodeImage(barcode) {
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
            const filePath = path.join(__dirname, 'uploads', `${barcode}.png`);
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
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
