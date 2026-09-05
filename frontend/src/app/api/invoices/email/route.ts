import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      pdf_base64,
      filename,
      to_email,
      smtp_host,
      smtp_port,
      smtp_user,
      smtp_pass,
      from_email,
      subject,
      text_content,
    } = body;

    if (!pdf_base64 || !to_email) {
      return NextResponse.json(
        { error: "PDF content (pdf_base64) and recipient email (to_email) are required" },
        { status: 400 }
      );
    }

    const host = smtp_host || process.env.SMTP_HOST || "smtp.gmail.com";
    const port = Number(smtp_port || process.env.SMTP_PORT || 587);
    const user = smtp_user || process.env.SMTP_USER;
    const pass = smtp_pass || process.env.SMTP_PASS;
    const sender = from_email || process.env.SMTP_FROM || user || "sales@stepsolar.in";

    if (!user || !pass) {
      return NextResponse.json(
        {
          error:
            "SMTP credentials not configured. Please enter SMTP User & App Password in Email Settings.",
        },
        { status: 400 }
      );
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass,
      },
    });

    const pdfBuffer = Buffer.from(pdf_base64.replace(/^data:application\/pdf;base64,/, ""), "base64");

    const mailOptions = {
      from: `Step Solar <${sender}>`,
      to: to_email,
      subject: subject || `Step Solar Document - ${filename || "Invoice.pdf"}`,
      text: text_content || "Aapka Step Solar document attached hai.",
      attachments: [
        {
          filename: filename || "StepSolar_Document.pdf",
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    };

    await transporter.sendMail(mailOptions);

    return NextResponse.json({ success: true, message: "Email forwarded successfully" });
  } catch (err) {
    console.error("[invoices/email] Send failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
