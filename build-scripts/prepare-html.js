const fs = require('fs');
const path = require('path');

// Read the original index.html
const indexPath = path.resolve(__dirname, '../index.html');
const outputPath = path.resolve(__dirname, '../index.build.html');

let htmlContent = fs.readFileSync(indexPath, 'utf8');

// Remove local CSS reference
htmlContent = htmlContent.replace(
    /<link rel="stylesheet" href="styles\.css">\n?/g,
    ''
);

// Remove local JavaScript references
htmlContent = htmlContent.replace(
    /<script src="i18n\.js"><\/script>\n?/g,
    ''
);

htmlContent = htmlContent.replace(
    /<script src="app\.js"><\/script>\n?/g,
    ''
);

// Write the modified HTML to a temporary build file
fs.writeFileSync(outputPath, htmlContent, 'utf8');

console.log('✓ Generated index.build.html for webpack processing');
