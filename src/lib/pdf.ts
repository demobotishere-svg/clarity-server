import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import pLimit from 'p-limit';

// Limit PDF generation to 3 concurrent instances server-wide to prevent OOM crashes
const pdfQueue = pLimit(3);

function parseMarkdown(text: string): string {
  // Parse markdown and strictly sanitize the resulting HTML to prevent XSS
  const rawHtml = marked.parse(text) as string;
  return sanitizeHtml(rawHtml);
}

export async function generateReportPDF(
  assessmentId: string,
  userName: string,
  qaPairs: { question: string; answer: string }[],
  analysisReport: string,
  score: number,
  paymentLinkUrl: string
): Promise<string> {
  const reportsDir = path.join(process.cwd(), 'public', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const fileName = `report_${assessmentId}.pdf`;
  const filePath = path.join(reportsDir, fileName);

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Clarity Assessment</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;600;700;800&display=swap');
    
    body {
      font-family: 'Montserrat', sans-serif;
      margin: 0;
      padding: 0;
      color: #1f2937;
      background: #fff;
    }
    .header {
      border-bottom: 3px solid #111827;
      padding-bottom: 20px;
      margin-bottom: 40px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .brand {
      font-size: 36px;
      font-weight: 800;
      color: #111827;
      letter-spacing: -1.5px;
    }
    .brand span {
      color: #3b82f6;
    }
    .meta {
      text-align: right;
      font-size: 12px;
      color: #6b7280;
    }
    .hero-section {
      text-align: center;
      margin-bottom: 50px;
      padding: 40px 20px;
      background: #f8fafc;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
    }
    .title {
      font-size: 32px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 12px;
      letter-spacing: -0.5px;
    }
    .subtitle {
      font-size: 18px;
      color: #475569;
      font-weight: 400;
      margin-bottom: 24px;
    }
    .score-badge {
      display: inline-block;
      background: #1e40af;
      color: white;
      padding: 12px 24px;
      border-radius: 30px;
      font-size: 20px;
      font-weight: 700;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    .score-text {
      font-size: 14px;
      font-weight: 400;
      opacity: 0.9;
      margin-right: 8px;
    }
    .analysis-content {
      font-size: 15px;
      color: #334155;
      line-height: 1.7;
    }
    .analysis-content p, .analysis-content li {
      margin-bottom: 16px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .analysis-content strong {
      color: #0f172a;
      font-weight: 700;
    }
    .analysis-content ul, .analysis-content ol {
      margin-bottom: 24px;
      padding-left: 20px;
    }
    .analysis-content li {
      margin-bottom: 12px;
    }
    .analysis-content h1, .analysis-content h2, .analysis-content h3 {
      color: #0f172a;
      margin-top: 40px;
      margin-bottom: 16px;
      font-weight: 700;
      page-break-after: avoid;
      break-after: avoid;
    }
    .analysis-content h2 {
      font-size: 22px;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 8px;
    }
    .cta-container {
      text-align: center;
      margin-top: 60px;
      page-break-inside: avoid;
    }
    .cta-btn {
      display: inline-block;
      background: #2563eb;
      color: #ffffff;
      padding: 16px 40px;
      border-radius: 8px;
      font-size: 20px;
      font-weight: 700;
      text-decoration: none;
      box-shadow: 0 4px 14px 0 rgba(37, 99, 235, 0.39);
      transition: all 0.2s ease;
    }
    .footer {
      margin-top: 40px;
      text-align: center;
      font-size: 12px;
      color: #94a3b8;
      border-top: 1px solid #e2e8f0;
      padding-top: 20px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
  </style>
</head>
<body>
  <div>
    <div class="header">
      <div class="brand">Clarity<span>.</span></div>
      <div class="meta">
        <div>Prepared exclusively for: <strong>${userName}</strong></div>
        <div>Date: ${new Date().toLocaleDateString()}</div>
      </div>
    </div>

    <div class="hero-section">
      <div class="title">AI Readiness Analysis</div>
      <div class="subtitle">A Strategic Roadmap to Outpace Your Competition</div>
      <div class="score-badge">
        <span class="score-text">AI Readiness Score:</span> ${score} / 100
      </div>
    </div>

    <div class="analysis-content">
      ${parseMarkdown(analysisReport)}
    </div>

    <div class="cta-container">
      <div style="font-size: 22px; font-weight: 800; color: #0f172a; margin-bottom: 16px;">Ready to transform your business?</div>
      <a href="${paymentLinkUrl}" class="cta-btn">Join Clarity Masterclass Now</a>
    </div>

    <div class="footer">
      Confidential & Proprietary • Prepared by Clarity AI
    </div>
  </div>
</body>
</html>
  `;

  return pdfQueue(async () => {
    // Launch Puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
    
    try {
      // Generate PDF with a strict 15-second timeout
      await page.pdf({
        path: filePath,
        format: 'A4',
        printBackground: true,
        timeout: 15000,
        margin: {
          top: '60px',
          right: '60px',
          bottom: '60px',
          left: '60px'
        }
      });
    } catch (error) {
      console.error("PDF Generation timed out or failed:", error);
      throw new Error("Failed to generate PDF document.");
    } finally {
      await browser.close();
    }

    return fileName;
  });
}
