const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

// Configure marked for GitHub-flavored markdown
marked.setOptions({
  gfm: true,
  breaks: true,
});

const htmlTemplate = (title, content) => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Routa JS</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
            padding: 2rem;
        }
        
        .container {
            max-width: 900px;
            margin: 0 auto;
            background: white;
            padding: 3rem;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        
        .back-link {
            display: inline-block;
            margin-bottom: 2rem;
            color: #667eea;
            text-decoration: none;
            font-weight: 600;
        }
        
        .back-link:hover {
            text-decoration: underline;
        }
        
        h1 {
            color: #667eea;
            margin-bottom: 1.5rem;
            border-bottom: 3px solid #667eea;
            padding-bottom: 0.5rem;
        }
        
        h2 {
            color: #764ba2;
            margin-top: 2rem;
            margin-bottom: 1rem;
        }
        
        h3 {
            color: #667eea;
            margin-top: 1.5rem;
            margin-bottom: 0.75rem;
        }
        
        pre {
            background: #2d3748;
            color: #e2e8f0;
            padding: 1.5rem;
            border-radius: 6px;
            overflow-x: auto;
            margin: 1rem 0;
        }
        
        code {
            background: #f4f4f4;
            padding: 0.2rem 0.4rem;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
            font-size: 0.9em;
        }
        
        pre code {
            background: none;
            padding: 0;
        }
        
        blockquote {
            border-left: 4px solid #667eea;
            padding-left: 1rem;
            margin: 1rem 0;
            color: #666;
            font-style: italic;
        }
        
        a {
            color: #667eea;
            text-decoration: none;
        }
        
        a:hover {
            text-decoration: underline;
        }
        
        ul, ol {
            margin-left: 2rem;
            margin-bottom: 1rem;
        }
        
        li {
            margin: 0.5rem 0;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 1rem 0;
        }
        
        th, td {
            border: 1px solid #ddd;
            padding: 0.75rem;
            text-align: left;
        }
        
        th {
            background: #667eea;
            color: white;
        }
        
        tr:nth-child(even) {
            background: #f9f9f9;
        }
    </style>
</head>
<body>
    <div class="container">
        <a href="../index.html" class="back-link">← Back to Home</a>
        ${content}
    </div>
</body>
</html>`;

// Convert markdown files to HTML
// To add new documentation files, add them to this array:
// { input: 'filename.md', output: 'filename.html', title: 'Page Title' }
const docsDir = path.join(__dirname, 'docs', 'agent-mcp');
const files = [
  { input: 'MCP_SETUP_GUIDE.md', output: 'MCP_SETUP_GUIDE.html', title: 'MCP Setup Guide' },
  { input: 'MCP_IMPLEMENTATION.md', output: 'MCP_IMPLEMENTATION.html', title: 'MCP Implementation' }
];

let hasErrors = false;

files.forEach(({ input, output, title }) => {
  const inputPath = path.join(docsDir, input);
  const outputPath = path.join(docsDir, output);
  
  if (fs.existsSync(inputPath)) {
    const markdown = fs.readFileSync(inputPath, 'utf8');
    const html = marked(markdown);
    const fullHtml = htmlTemplate(title, html);
    
    fs.writeFileSync(outputPath, fullHtml);
    console.log(`✓ Converted ${input} to ${output}`);
  } else {
    console.error(`✗ Error: File not found: ${input}`);
    hasErrors = true;
  }
});

if (hasErrors) {
  console.error('\nDocumentation conversion failed due to missing files!');
  process.exit(1);
}

console.log('\nDocumentation conversion complete!');
