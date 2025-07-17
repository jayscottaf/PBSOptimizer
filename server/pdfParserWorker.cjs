const fs = require('fs');
const pdfParse = require('pdf-parse');

// Standalone Node.js worker for PDF parsing
async function extractPDFText(filePath) {
  try {
    console.log(`Worker: Extracting text from ${filePath}`);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`PDF file not found: ${filePath}`);
    }
    
    const buffer = fs.readFileSync(filePath);
    console.log(`Worker: PDF buffer loaded: ${buffer.length} bytes`);
    
    const data = await pdfParse(buffer);
    console.log(`Worker: PDF parsed successfully: ${data.text.length} characters extracted`);
    
    return data.text;
  } catch (error) {
    console.error('Worker: Error extracting text from PDF:', error);
    throw error;
  }
}

// Handle command line arguments
if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node pdfParserWorker.js <filepath>');
    process.exit(1);
  }
  
  extractPDFText(filePath)
    .then(text => {
      console.log('SUCCESS');
      console.log(JSON.stringify({ text }));
    })
    .catch(error => {
      console.error('ERROR:', error.message);
      process.exit(1);
    });
}

module.exports = { extractPDFText };