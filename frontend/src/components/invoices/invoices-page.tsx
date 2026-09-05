"use client";

import { useState, useMemo, useEffect } from "react";
import { uploadAccountMedia } from "@/lib/storage/upload-media";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Send,
  Download,
  Plus,
  Trash2,
  Zap,
  RotateCcw,
  ArrowLeft,
  Share2,
  CheckCircle2,
  Loader2,
  FolderOpen,
  Mail,
  Settings,
} from "lucide-react";
import { toast } from "sonner";

type DocMode = "invoice" | "quotation" | "receipt" | "commercial";

interface ItemRow {
  id: string;
  desc: string;
  hsn: string;
  qty: number;
  unit: string;
  price: number;
  gst: number;
}

interface SavedRecord {
  id: string;
  mode: DocMode;
  docNo: string;
  dateStr: string;
  custName: string;
  custPhone: string;
  custAddress: string;
  payMode: string;
  supplyType: string;
  branchAddress: string;
  branchPhone: string;
  items?: ItemRow[];
  savedGrandTotal: number;
  savedAt: number;
  subsidyCentral?: number;
  subsidyState?: number;
  validity?: string;
  capacity?: number;
  technology?: string;
  spaceRequired?: string;
  application?: string;
  rate?: number;
  gstPct?: number;
  payAdvance?: number;
  payDispatch?: number;
  payInstall?: number;
  amount?: number;
  balance?: number;
  remarks?: string;
  refInvoice?: string;
}

const LOGO_DATA_URI = "/step-solar-logo.jpg";
const EMAIL_SETTINGS_STORAGE_KEY = "stepsolar:email_settings";

const DEFAULT_INVOICE_ITEMS: ItemRow[] = [
  {
    id: "1",
    desc: "TATA Bifacial 590WP +String Ongrid Inverter",
    hsn: "85414300",
    qty: 1,
    unit: "Set",
    price: 131790.48,
    gst: 5,
  },
  {
    id: "2",
    desc: "BOS - Erection, Installation & Commissioning Services",
    hsn: "9954",
    qty: 1,
    unit: "Nos",
    price: 41203.39,
    gst: 18,
  },
];

const DEFAULT_QUOTE_ITEMS: ItemRow[] = [
  { id: "1", desc: "Solar Module (Bifacial DCR)", hsn: "590 WP (TATA)", qty: 5, unit: "Nos.", price: 33591.17, gst: 5 },
  { id: "2", desc: "Ongrid Solar Inverter", hsn: "3 KW (TATA)", qty: 1, unit: "Nos.", price: 0, gst: 5 },
  { id: "3", desc: "ACDB (AC Distribution Box)", hsn: "Standard", qty: 1, unit: "Nos.", price: 0, gst: 18 },
  { id: "4", desc: "DCDB (DC Distribution Box)", hsn: "Standard", qty: 1, unit: "Nos.", price: 0, gst: 18 },
  { id: "5", desc: "Wiring Kit", hsn: "Standard", qty: 1, unit: "Nos.", price: 0, gst: 18 },
  { id: "6", desc: "Earthing Kit", hsn: "Standard", qty: 1, unit: "Nos.", price: 0, gst: 18 },
  { id: "7", desc: "All Standard G.I. Structures", hsn: "Standard Heavy Duty", qty: 1, unit: "Nos.", price: 0, gst: 18 },
  { id: "8", desc: "AC Cable / DC Cable / Earthing Wire", hsn: "Standard High Quality", qty: 3, unit: "Set", price: 0, gst: 18 },
  { id: "9", desc: "Transportation Charges", hsn: "Safe Transit to Site", qty: 1, unit: "Incl.", price: 0, gst: 18 },
  { id: "10", desc: "Installation Charges", hsn: "Complete Commissioning", qty: 1, unit: "Incl.", price: 0, gst: 18 },
];

const DEFAULT_COMMERCIAL_ITEMS: ItemRow[] = [
  { id: "1", desc: "Solar PV Modules (Bifacial DCR)", hsn: "590Wp TOPCON (Waaree)", qty: 86, unit: "Nos.", price: 0, gst: 0 },
  { id: "2", desc: "Grid-Tie Solar Inverter", hsn: "50 kW Heavy Duty On-Grid Inverter (Waaree)", qty: 1, unit: "Nos.", price: 0, gst: 0 },
  { id: "3", desc: "AC Distribution Box (ACDB)", hsn: "160A 4P MCCB & 320A IP & OP Standard Protection", qty: 1, unit: "Nos.", price: 0, gst: 0 },
  { id: "4", desc: "DC Distribution Box (DCDB)", hsn: "Standard Array Junction Box with SPD & Fuses", qty: 1, unit: "Nos.", price: 0, gst: 0 },
  { id: "5", desc: "Module Mounting Structure (MMS)", hsn: "HDG / Aluminum Short Rail Heavy Duty Structure", qty: 1, unit: "Set", price: 0, gst: 0 },
  { id: "6", desc: "Solar DC Cable", hsn: "1C x 4 Sq.mm / 6 Sq.mm XLPE Copper Cable", qty: 650, unit: "Mtr.", price: 0, gst: 0 },
  { id: "7", desc: "AC Armored Cable", hsn: "3.5C x 70 Sq.mm Aluminum Armored XLPE Cable", qty: 50, unit: "Mtr.", price: 0, gst: 0 },
  { id: "8", desc: "Earthing & Protection System", hsn: "1.5M Copper Bonded Chemical Earthing Rods", qty: 3, unit: "Sets", price: 0, gst: 0 },
  { id: "9", desc: "Lightning Arrester (LA)", hsn: "Umbrella ESE LA with 3M Mast & Base Plate", qty: 1, unit: "Set", price: 0, gst: 0 },
  { id: "10", desc: "MC4 Connectors & Wiring Kit", hsn: "UV Resistant Male/Female Connectors & Accessories", qty: 50, unit: "Pairs", price: 0, gst: 0 },
  { id: "11", desc: "Module Cleaning Kit", hsn: "Manual Cleaning System (UPVC/HDPE Pipe & Hose)", qty: 1, unit: "Set", price: 0, gst: 0 },
  { id: "12", desc: "Transportation & Civil I&C", hsn: "Safe Transit to Site, Installation & Commissioning", qty: 1, unit: "Incl.", price: 0, gst: 0 },
];

function inr(n: number): string {
  return "₹" + (n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function numberToWordsIndian(num: number): string {
  num = Math.round(num);
  if (num === 0) return "Zero";
  const a = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  function two(n: number): string {
    if (n < 20) return a[n];
    return b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "");
  }
  function three(n: number): string {
    if (n > 99) return a[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + two(n % 100) : "");
    return two(n);
  }
  let str = "";
  const crore = Math.floor(num / 10000000);
  num %= 10000000;
  const lakh = Math.floor(num / 100000);
  num %= 100000;
  const thousand = Math.floor(num / 1000);
  num %= 1000;
  const hundred = num;
  if (crore) str += three(crore) + " Crore ";
  if (lakh) str += three(lakh) + " Lakh ";
  if (thousand) str += three(thousand) + " Thousand ";
  if (hundred) str += three(hundred);
  return str.trim();
}

function computeItemCalcs(items: ItemRow[]) {
  return items.map((i) => {
    const amount = i.qty * i.price;
    const gstAmt = (amount * i.gst) / 100;
    return { ...i, amount, gstAmt, total: amount + gstAmt };
  });
}

// ===================== EXACT-REPLICA HTML RENDERERS FROM Invoice (3).html =====================
function renderInvoiceHtml(record: SavedRecord): string {
  const items = computeItemCalcs(record.items || []);
  const taxable = items.reduce((s, i) => s + i.amount, 0);
  const gstTotal = items.reduce((s, i) => s + i.gstAmt, 0);
  const grand = taxable + gstTotal;

  const itemRows = items
    .map(
      (i, idx) => `
    <tr>
      <td class="center">${idx + 1}</td>
      <td>${i.desc}</td>
      <td class="center">${i.hsn || "-"}</td>
      <td class="center">${i.qty}</td>
      <td class="center">${i.unit}</td>
      <td class="right">${inr(i.price)}</td>
      <td class="center">${i.gst}%</td>
      <td class="right">${inr(i.gstAmt)}</td>
      <td class="right">${inr(i.total)}</td>
    </tr>`
    )
    .join("");
  const totalQty = items.reduce((s, i) => s + i.qty, 0);

  const groups: Record<string, { hsn: string; taxable: number; gst: number }> = {};
  items.forEach((i) => {
    const key = i.hsn || "-";
    if (!groups[key]) groups[key] = { hsn: key, taxable: 0, gst: i.gst };
    groups[key].taxable += i.amount;
  });
  const isIgst = (record.supplyType || "igst") !== "cgst_sgst";
  const gstRows = Object.values(groups)
    .map((g) => {
      if (isIgst) {
        const igst = (g.taxable * g.gst) / 100;
        return `<tr>
        <td class="center">${g.hsn}</td>
        <td class="right">${inr(g.taxable)}</td>
        <td class="center">${g.gst}%</td>
        <td class="right">${inr(igst)}</td>
        <td class="right">${inr(igst)}</td>
      </tr>`;
      }
      const half = g.gst / 2;
      const cgst = (g.taxable * half) / 100,
        sgst = (g.taxable * half) / 100;
      return `<tr>
      <td class="center">${g.hsn}</td>
      <td class="right">${inr(g.taxable)}</td>
      <td class="center">${half}%</td>
      <td class="right">${inr(cgst)}</td>
      <td class="center">${half}%</td>
      <td class="right">${inr(sgst)}</td>
      <td class="right">${inr(cgst + sgst)}</td>
    </tr>`;
    })
    .join("");

  const totCgst = Object.values(groups).reduce((s, g) => s + (g.taxable * (g.gst / 2)) / 100, 0);
  const totSgst = totCgst;
  const totIgst = Object.values(groups).reduce((s, g) => s + (g.taxable * g.gst) / 100, 0);
  const gstTableHead = isIgst
    ? `<thead><tr class="bold" style="background:#eef3f0;"><td class="center">HSN</td><td class="center">Taxable Amount (₹)</td><td class="center">IGST Rate</td><td class="center">IGST Amt (₹)</td><td class="center">Total Tax (₹)</td></tr></thead>`
    : `<thead><tr class="bold" style="background:#eef3f0;"><td class="center">HSN</td><td class="center">Taxable Amount (₹)</td><td class="center">CGST Rate</td><td class="center">CGST Amt (₹)</td><td class="center">SGST Rate</td><td class="center">SGST Amt (₹)</td><td class="center">Total Tax (₹)</td></tr></thead>`;
  const gstTableFoot = isIgst
    ? `<tr class="bold"><td class="center">TOTAL</td><td class="right">${inr(taxable)}</td><td></td><td class="right">${inr(totIgst)}</td><td class="right">${inr(totIgst)}</td></tr>`
    : `<tr class="bold"><td class="center">TOTAL</td><td class="right">${inr(taxable)}</td><td></td><td class="right">${inr(totCgst)}</td><td></td><td class="right">${inr(totSgst)}</td><td class="right">${inr(totCgst + totSgst)}</td></tr>`;
  const words = numberToWordsIndian(grand);

  return `
    <table>
      <tr>
        <td rowspan="3" style="width:100px;" class="noB center">${LOGO_DATA_URI ? `<img class="logo" src="${LOGO_DATA_URI}">` : ''}</td>
        <td colspan="2" class="center big">STEP SOLAR ENERGY PVT. LTD.</td>
      </tr>
      <tr><td colspan="2" class="center small"><b>Branch Address:-</b> ${record.branchAddress} &nbsp;&nbsp;&nbsp; <b>Phone:</b> ${record.branchPhone}</td></tr>
      <tr><td colspan="2" class="center bold small">GSTIN: 09ABPCS3779K1ZC</td></tr>
      <tr><td colspan="3" class="center midtitle">TAX INVOICE</td></tr>
    </table>

    <table>
      <tr><td colspan="2" class="center bold">BILL TO</td><td colspan="2" class="center bold">INVOICE DETAILS</td></tr>
      <tr><td class="label">Customer Name:</td><td>${record.custName}</td><td class="label">Invoice No:</td><td>${record.docNo}</td></tr>
      <tr><td class="label">Contact No:</td><td>${record.custPhone}</td><td class="label">Invoice Date:</td><td>${record.dateStr}</td></tr>
      <tr><td class="label">Place of Supply:</td><td>${record.custAddress}</td><td class="label">Payment Mode:</td><td>${record.payMode}</td></tr>
      <tr><td class="label">Supply Type:</td><td colspan="3">${isIgst ? 'Inter-State (IGST applicable)' : 'Intra-State (CGST + SGST applicable)'}</td></tr>
    </table>

    <table>
      <thead>
        <tr class="bold" style="background:#eef3f0;">
          <td class="center">S.No</td><td>Item Description</td><td class="center">HSN/SAC</td><td class="center">Qty</td>
          <td class="center">Unit</td><td class="center">Price/Unit (₹)</td><td class="center">GST (%)</td>
          <td class="center">GST Amt (₹)</td><td class="center">Amount (₹)</td>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        <tr class="bold"><td colspan="3" class="center">Total</td><td class="center">${totalQty}</td><td colspan="3"></td><td class="right">${inr(gstTotal)}</td><td class="right">${inr(grand)}</td></tr>
      </tbody>
    </table>

    <table><tr><td class="noB bold sectionbar">GST Tax Summary Breakdown (${isIgst ? 'IGST — Inter-State Supply' : 'CGST + SGST — Intra-State Supply'}):</td></tr></table>
    <table>
      ${gstTableHead}
      <tbody>
        ${gstRows}
        ${gstTableFoot}
      </tbody>
    </table>

    <table>
      <tr>
        <td rowspan="3" style="width:50%;">
          <div class="bold">Amount In Words:</div>
          <div class="italic" style="margin-top:10px;">${words} Rupees Only</div>
        </td>
        <td class="label">Sub Total:</td><td class="right">${inr(grand)}</td>
      </tr>
      <tr><td class="label">Round off:</td><td class="right">₹0.00</td></tr>
      <tr><td class="label bold">Grand Total:</td><td class="right bold">${inr(grand)}</td></tr>
    </table>

    <table>
      <tr>
        <td colspan="2" class="bold">Bank Account Details for Payments:</td>
        <td colspan="2" class="center bold">Terms &amp; Conditions:</td>
      </tr>
      <tr>
        <td class="label">Account Name:</td><td>STEP SOLAR ENERGY PVT LTD</td>
        <td colspan="2" rowspan="4" class="small italic" style="vertical-align:top;">
          1. Goods once sold will not be taken back.<br>
          2. Payment terms as agreed upon ordering.<br>
          3. Thanks for doing business with us!<br><br>
          <b class="italic" style="font-style:normal;">For STEP SOLAR ENERGY PVT. LTD.</b><br><br><br>
          <span class="italic">Authorized Signatory</span>
        </td>
      </tr>
      <tr><td class="label">Bank Name:</td><td>State Bank of India</td></tr>
      <tr><td class="label">Account No:</td><td>44347774983</td></tr>
      <tr><td class="label">IFSC Code:</td><td>SBIN0064874</td></tr>
      <tr><td class="label">Branch Name:</td><td colspan="1">Bhadaura</td></tr>
    </table>
  `;
}

function renderQuotationHtml(record: SavedRecord): string {
  const items = computeItemCalcs(record.items || []);
  const goods = items.filter((i) => i.gst === 5);
  const install = items.filter((i) => i.gst !== 5);
  const goodsTaxable = goods.reduce((s, i) => s + i.amount, 0);
  const goodsGst = goods.reduce((s, i) => s + i.gstAmt, 0);
  const installTaxable = install.reduce((s, i) => s + i.amount, 0);
  const installGst = install.reduce((s, i) => s + i.gstAmt, 0);
  const taxableTotal = goodsTaxable + installTaxable;
  const gstTotal = goodsGst + installGst;
  const grand = taxableTotal + gstTotal;
  const cs = record.subsidyCentral || 0,
    ss = record.subsidyState || 0;
  const totalSubsidy = cs + ss;
  const netPayable = grand - totalSubsidy;

  const itemRows = items
    .map(
      (i, idx) => `
    <tr>
      <td class="center">${idx + 1}</td>
      <td>${i.desc}</td>
      <td class="center">${i.hsn || "-"}</td>
      <td class="center">${i.qty}</td>
      <td class="center">${i.unit}</td>
    </tr>`
    )
    .join("");

  const words = numberToWordsIndian(netPayable);
  const qIsIgst = (record.supplyType || "igst") !== "cgst_sgst";
  const gstTag = qIsIgst ? "IGST" : "CGST+SGST";

  return `
    <table>
      <tr>
        <td colspan="2" class="center big" style="font-size:19px;">STEP SOLAR ENERGY PVT LTD</td>
        <td rowspan="4" style="width:100px;" class="noB center">${LOGO_DATA_URI ? `<img class="logo" src="${LOGO_DATA_URI}">` : ''}</td>
      </tr>
      <tr><td colspan="2" class="center small">GSTIN: 09ABPCS3779K1ZC</td></tr>
      <tr><td colspan="2" class="center small">Address: ${record.branchAddress}</td></tr>
      <tr><td colspan="2" class="center small">Mobile No.:- ${record.branchPhone} | Email: sales@stepsolar.in</td></tr>
      <tr><td colspan="3" class="center midtitle">QUOTATION</td></tr>
    </table>

    <table>
      <tr><td colspan="2" class="center bold">Quotation To</td><td class="center bold">Date:</td></tr>
      <tr><td class="label" style="width:110px;">Customer Name</td><td>${record.custName}</td><td rowspan="3" class="center">${record.dateStr}</td></tr>
      <tr><td class="label">Address</td><td>${record.custAddress}</td></tr>
      <tr><td class="label">Contact No.</td><td>${record.custPhone}</td></tr>
      <tr><td class="label">Supply Type</td><td colspan="2">${qIsIgst ? 'Inter-State (IGST applicable)' : 'Intra-State (CGST + SGST applicable)'}</td></tr>
    </table>

    <table><tr><td class="noB bold center sectionbar">Technical Specifications &amp; Scope of Supply</td></tr></table>
    <table>
      <thead><tr class="bold" style="background:#eef3f0;"><td class="center">S.No</td><td>Item Description / Equipment</td><td class="center">Brand / Specification</td><td class="center">Qty</td><td class="center">Unit</td></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>

    <table><tr><td class="noB bold center sectionbar">Commercial Summary &amp; Tax Breakdown</td></tr></table>
    <table>
      <tr><td class="label" style="width:70%;">Goods Taxable Value</td><td class="right">${inr(goodsTaxable)}</td></tr>
      <tr><td class="label">${gstTag} @ 5%</td><td class="right">${inr(goodsGst)}</td></tr>
      <tr><td class="label">Installation/Services Taxable Value</td><td class="right">${inr(installTaxable)}</td></tr>
      <tr><td class="label">${gstTag} @ 18%</td><td class="right">${inr(installGst)}</td></tr>
      <tr class="bold"><td class="label">Taxable Amount (Excl. GST)</td><td class="right">${inr(taxableTotal)}</td></tr>
      <tr class="bold"><td class="label">Total GST</td><td class="right">${inr(gstTotal)}</td></tr>
      <tr class="bold"><td class="label">Total Gross Payable Amount (Incl. of GST)</td><td class="right">${inr(grand)}</td></tr>
      <tr><td class="label">Less: Central Government Subsidy Benefit</td><td class="right">${inr(cs)}</td></tr>
      <tr><td class="label">Less: UP-State Government Subsidy Benefit</td><td class="right">${inr(ss)}</td></tr>
      <tr class="bold"><td class="label">Total Estimated Subsidy Benefit</td><td class="right">${inr(totalSubsidy)}</td></tr>
      <tr class="bold"><td class="label">Net Payable Amount (Est.)</td><td class="right">${inr(netPayable)}</td></tr>
    </table>

    <table>
      <tr><td colspan="2" class="center bold">Bank Account Details for Payments</td><td colspan="2" class="center bold">Lists of Documents Required</td></tr>
      <tr><td colspan="2">Account Name: STEP SOLAR ENERGY PVT LTD</td><td colspan="2">1. Latest Electricity Bill Copy</td></tr>
      <tr><td colspan="2">Account Number: 44347774983</td><td colspan="2">2. Property Tax Receipt / Panchayat Letter</td></tr>
      <tr><td colspan="2">IFSC Code: SBIN0064874</td><td colspan="2">3. Aadhaar Card</td></tr>
      <tr><td colspan="2">Bank &amp; Branch: State Bank of India, Bhadaura</td><td colspan="2">4. PAN Card</td></tr>
      <tr><td colspan="2"></td><td colspan="2">5. Cancelled Cheque / Bank Passbook</td></tr>
    </table>

    <div style="page-break-inside:avoid;break-inside:avoid;">
      <table>
        <tr><td class="center bold">For Step Solar Energy Pvt Ltd</td><td class="center bold">Customer Acceptance</td></tr>
        <tr><td style="height:44px;"></td><td></td></tr>
        <tr><td class="center">Authorized Signatory</td><td class="center">Signature &amp; Date</td></tr>
      </table>
      <p class="small italic" style="padding:6px 4px;border:1px solid #000;border-top:none;margin:0;">Amount in Words (Net Payable): ${words} Rupees Only</p>
    </div>
  `;
}

function renderReceiptHtml(record: SavedRecord): string {
  const amount = record.amount || 0;
  const words = numberToWordsIndian(amount);
  return `
    <table>
      <tr>
        <td rowspan="3" style="width:100px;" class="noB center">${LOGO_DATA_URI ? `<img class="logo" src="${LOGO_DATA_URI}">` : ''}</td>
        <td colspan="2" class="center big">STEP SOLAR ENERGY PVT. LTD.</td>
      </tr>
      <tr><td colspan="2" class="center small"><b>Branch Address:-</b> ${record.branchAddress} &nbsp;&nbsp;&nbsp; <b>Phone:</b> ${record.branchPhone}</td></tr>
      <tr><td colspan="2" class="center bold small">GSTIN: 09ABPCS3779K1ZC</td></tr>
      <tr><td colspan="3" class="center midtitle">PAYMENT RECEIPT</td></tr>
    </table>

    <table>
      <tr><td colspan="2" class="center bold">RECEIVED FROM</td><td colspan="2" class="center bold">RECEIPT DETAILS</td></tr>
      <tr><td class="label">Customer Name:</td><td>${record.custName}</td><td class="label">Receipt No:</td><td>${record.docNo}</td></tr>
      <tr><td class="label">Contact No:</td><td>${record.custPhone}</td><td class="label">Date:</td><td>${record.dateStr}</td></tr>
      <tr><td class="label">Address:</td><td>${record.custAddress}</td><td class="label">Payment Mode:</td><td>${record.payMode}</td></tr>
      ${record.refInvoice ? `<tr><td class="label">Received Against:</td><td colspan="3">${record.refInvoice}</td></tr>` : ''}
    </table>

    <table>
      <tr><td class="label" style="width:70%;">Amount Received</td><td class="right bold">${inr(amount)}</td></tr>
      <tr><td class="label">Balance Due</td><td class="right">${inr(record.balance || 0)}</td></tr>
      ${record.remarks ? `<tr><td class="label">Remarks</td><td>${record.remarks}</td></tr>` : ''}
    </table>

    <table>
      <tr><td class="bold" style="width:50%;">Amount In Words:</td><td></td></tr>
      <tr><td colspan="2" class="italic">${words} Rupees Only</td></tr>
    </table>

    <table>
      <tr><td colspan="2" class="bold">Bank Account Details for Payments:</td></tr>
      <tr><td class="label">Account Name:</td><td>STEP SOLAR ENERGY PVT LTD</td></tr>
      <tr><td class="label">Bank Name:</td><td>State Bank of India</td></tr>
      <tr><td class="label">Account No:</td><td>44347774983</td></tr>
      <tr><td class="label">IFSC Code:</td><td>SBIN0064874</td></tr>
      <tr><td class="label">Branch Name:</td><td>Bhadaura</td></tr>
    </table>

    <table>
      <tr><td class="center" style="height:44px;"></td><td class="center bold" style="text-align:right;">For STEP SOLAR ENERGY PVT. LTD.</td></tr>
      <tr><td class="center">Customer Signature</td><td class="center" style="text-align:right;">Authorized Signatory</td></tr>
    </table>
  `;
}

function renderCommercialHtml(record: SavedRecord): string {
  const items = record.items || [];
  const capacity = record.capacity || 0;
  const wp = capacity * 1000;
  const base = wp * (record.rate || 0);
  const gstAmt = (base * (record.gstPct || 0)) / 100;
  const grand = base + gstAmt;

  const bomRows = items
    .map(
      (i, idx) => `
    <tr>
      <td class="center">${idx + 1}</td>
      <td>${i.desc}</td>
      <td>${i.hsn || "-"}</td>
      <td class="center">${i.qty}</td>
      <td class="center">${i.unit}</td>
    </tr>`
    )
    .join("");

  const adv = record.payAdvance || 0,
    disp = record.payDispatch || 0,
    inst = record.payInstall || 0;
  const advAmt = (grand * adv) / 100,
    dispAmt = (grand * disp) / 100,
    instAmt = (grand * inst) / 100;

  return `
    <table>
      <tr>
        <td colspan="2" class="center big" style="font-size:19px;">STEP SOLAR ENERGY PVT LTD</td>
        <td rowspan="6" style="width:100px;" class="noB center">${LOGO_DATA_URI ? `<img class="logo" src="${LOGO_DATA_URI}">` : ''}</td>
      </tr>
      <tr><td colspan="2" class="center small">Freedom • Future • Savings</td></tr>
      <tr><td colspan="2" class="center small">GSTIN: 09ABPCS3779K1ZC</td></tr>
      <tr><td colspan="2" class="center small">Address: ${record.branchAddress}</td></tr>
      <tr><td colspan="2" class="center small">Contact: +91 ${record.branchPhone} | Email: sales@stepsolar.in</td></tr>
      <tr><td colspan="2" class="center small">Website: www.stepsolar.in | FB: facebook.com/stepsolarenergy</td></tr>
      <tr><td colspan="3" class="center midtitle">QUOTATION</td></tr>
      <tr><td colspan="3" class="center small">Ref No: ${record.docNo} &nbsp;|&nbsp; Date: ${record.dateStr} &nbsp;|&nbsp; Validity: ${record.validity} Days</td></tr>
    </table>

    <table><tr><td class="noB bold center sectionbar">CLIENT DETAILS (QUOTATION TO)</td></tr></table>
    <table>
      <tr><td class="label" style="width:20%;">Customer Name</td><td>${record.custName}</td></tr>
      <tr><td class="label">Contact</td><td>${record.custPhone}</td></tr>
      <tr><td class="label">Address</td><td>${record.custAddress}</td></tr>
    </table>

    <table><tr><td class="noB bold center sectionbar">PROJECT OVERVIEW</td></tr></table>
    <table>
      <tr><td class="label" style="width:25%;">System Capacity</td><td>${capacity} KWp Grid-Tie Solar PV System</td></tr>
      <tr><td class="label">Technology</td><td>${record.technology || "-"}</td></tr>
      <tr><td class="label">Space Required</td><td>${record.spaceRequired || "-"}</td></tr>
      <tr><td class="label">Application</td><td>${record.application || "-"}</td></tr>
    </table>

    <table><tr><td class="noB bold sectionbar">1. INTRODUCTION &amp; COMPANY PROFILE</td></tr></table>
    <table><tr><td class="noB prose">
      Step Solar Energy Pvt Ltd is a leading renewable energy solutions provider headquartered in Varanasi, offering turn-key solar execution including design, engineering, procurement, installation, and long-term O&amp;M. We work with leading tier-1 brands — including Tata Power Solar, Waaree, Adani and Livguard — to deliver customized, high-efficiency solar solutions for industrial, commercial, and residential clients across North India.
      <br><br><b>Our Unique Value Proposition (USP):</b>
      <ul>
        <li><b>Multi-Brand Flexibility:</b> Complete freedom to choose top-tier solar modules and inverters based on your budget and technical requirements.</li>
        <li><b>1-Year Complimentary O&amp;M:</b> Every installation includes 1 year of free comprehensive maintenance (3 scheduled service &amp; cleaning visits) to ensure peak power generation and maximum savings.</li>
        <li><b>Proven Track Record:</b> Supported by tier-1 bankable technology, expert EPC execution, and end-to-end net-metering assistance.</li>
      </ul>
    </td></tr></table>

    <table><tr><td class="noB bold sectionbar">2. BILL OF MATERIALS (BOM) &amp; TECHNICAL SPECIFICATIONS</td></tr></table>
    <table>
      <thead><tr class="bold" style="background:#eef3f0;"><td class="center">S.N.</td><td>Equipment / Item Description</td><td>Specification / Make</td><td class="center">Qty</td><td class="center">Unit</td></tr></thead>
      <tbody>${bomRows}</tbody>
    </table>

    <table><tr><td class="noB bold sectionbar">3. COMMERCIAL PRICING &amp; FINANCIAL BREAKDOWN</td></tr></table>
    <table>
      <tr><td class="label" style="width:65%;">${capacity} KWp System @ ₹${(record.rate || 0).toFixed(2)}/Wp</td><td class="right">${inr(base)}</td></tr>
      <tr><td class="label">Applicable GST @ ${record.gstPct}%</td><td class="right">${inr(gstAmt)}</td></tr>
      <tr class="bold"><td class="label">GROSS TOTAL PAYABLE</td><td class="right">${inr(grand)}</td></tr>
    </table>

    <table><tr><td class="noB bold sectionbar">4. PAYMENT SCHEDULE &amp; BANK ACCOUNT DETAILS</td></tr></table>
    <table>
      <tr><td class="label" style="width:65%;">Advance with Purchase Order (PO) — ${adv}%</td><td class="right">${inr(advAmt)}</td></tr>
      <tr><td class="label">Before Dispatch of Material — ${disp}%</td><td class="right">${inr(dispAmt)}</td></tr>
      <tr><td class="label">After Installation &amp; Commissioning — ${inst}%</td><td class="right">${inr(instAmt)}</td></tr>
    </table>
    <table>
      <tr><td class="label" style="width:30%;">Account Name</td><td>STEP SOLAR ENERGY PVT LTD</td></tr>
      <tr><td class="label">Account Number</td><td>44347774983</td></tr>
      <tr><td class="label">IFSC Code</td><td>SBIN0064874</td></tr>
      <tr><td class="label">Bank &amp; Branch</td><td>State Bank of India, Bhadaura</td></tr>
    </table>

    <table><tr><td class="noB bold sectionbar">5. COMMERCIAL TERMS &amp; CONDITIONS</td></tr></table>
    <table>
      <thead><tr class="bold" style="background:#eef3f0;"><td style="width:20%;">Clause</td><td>Details</td></tr></thead>
      <tbody>
        <tr><td class="label">Price Firmness</td><td class="small">Price is exclusive of GST for design, manufacturing, sourcing, testing, supply &amp; commissioning. Statutory tax changes charged extra.</td></tr>
        <tr><td class="label">Offer Validity</td><td class="small">Proposal valid for ${record.validity} days from issue date.</td></tr>
        <tr><td class="label">Exclusions</td><td class="small">CEIG Liaisoning, Net-Metering approvals, and LT/HT panel alterations are in customer scope. Water supply (2-4 bar) at roof required.</td></tr>
        <tr><td class="label">Site Access</td><td class="small">Customer shall ensure unhindered physical access to site, access roads, legal possession, and road permits prior to dispatch.</td></tr>
        <tr><td class="label">Delivery &amp; Handover</td><td class="small">Completion within 15 weeks from NTP. System deemed commissioned once power is evacuated to client grid.</td></tr>
        <tr><td class="label">Warranty</td><td class="small">5-Year Comprehensive Warranty on complete system; 25-Year Performance Warranty on Solar PV Modules (≥ 80% output at year 25).</td></tr>
        <tr><td class="label">AMC / Operations</td><td class="small">Post warranty period, optional AMC available at standard rates of ₹200.00 / KWp / Year.</td></tr>
        <tr><td class="label">Liability &amp; Law</td><td class="small">Total liability limited to 5% of contract value. Any change in statutory law / tariffs will be adjusted at actuals.</td></tr>
      </tbody>
    </table>

    <table>
      <tr><td class="center bold">CUSTOMER ACCEPTANCE &amp; STAMP</td><td class="center bold">FOR STEP SOLAR ENERGY PVT LTD</td></tr>
      <tr><td style="height:50px;"></td><td></td></tr>
      <tr><td class="center">Authorized Signatory / Client<br>Date: ____ / ____ / ____</td><td class="center">Authorized Signatory<br>Step Solar Energy Pvt Ltd, Varanasi</td></tr>
    </table>
  `;
}

function renderDocHtml(record: SavedRecord): string {
  if (record.mode === "invoice") return renderInvoiceHtml(record);
  if (record.mode === "quotation") return renderQuotationHtml(record);
  if (record.mode === "commercial") return renderCommercialHtml(record);
  return renderReceiptHtml(record);
}

export function InvoicesPageContent() {
  const [mode, setMode] = useState<DocMode>("invoice");
  const [viewState, setViewState] = useState<"form" | "preview" | "records">("form");

  // Company details
  const [branchAddress, setBranchAddress] = useState("Dumri Padaw, Varanasi, U.P");
  const [branchPhone, setBranchPhone] = useState("8081252114");

  // Customer details
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custAddress, setCustAddress] = useState("");
  const [docNo, setDocNo] = useState("");
  const [docDate, setDocDate] = useState("");
  const [payMode, setPayMode] = useState("Online");
  const [supplyType, setSupplyType] = useState("igst");

  // Mode specific fields
  const [refInvoice, setRefInvoice] = useState("");
  const [validity, setValidity] = useState("15");

  // Commercial specific
  const [capacityKwp, setCapacityKwp] = useState("");
  const [technology, setTechnology] = useState("");
  const [spaceRequired, setSpaceRequired] = useState("");
  const [application, setApplication] = useState("");
  const [ratePerWp, setRatePerWp] = useState("");
  const [commercialGst, setCommercialGst] = useState("8.9");
  const [targetCommercialTotal, setTargetCommercialTotal] = useState("");
  const [payAdvance, setPayAdvance] = useState("10");
  const [payDispatch, setPayDispatch] = useState("80");
  const [payInstall, setPayInstall] = useState("10");

  // Quotation specific (Subsidy)
  const [subsidyCentral, setSubsidyCentral] = useState(78000);
  const [subsidyState, setSubsidyState] = useState(20000);

  // Receipt specific
  const [receiptAmount, setReceiptAmount] = useState(0);
  const [receiptBalance, setReceiptBalance] = useState(0);
  const [receiptRemarks, setReceiptRemarks] = useState("");

  // Target Grand Total Auto fill
  const [targetGrandTotal, setTargetGrandTotal] = useState("");

  // Items Table
  const [items, setItems] = useState<ItemRow[]>(DEFAULT_INVOICE_ITEMS);

  // Saved records
  const [records, setRecords] = useState<SavedRecord[]>([]);

  // Generated Record for Preview
  const [activeRecord, setActiveRecord] = useState<SavedRecord | null>(null);

  // Send Dialog State
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendPhone, setSendPhone] = useState("");
  const [sending, setSending] = useState(false);

  // Email Settings Dialog
  const [emailSettingsOpen, setEmailSettingsOpen] = useState(false);
  const [targetEmail, setTargetEmail] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");

  // Load email settings from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(EMAIL_SETTINGS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setTargetEmail(parsed.targetEmail || "");
        setSmtpHost(parsed.smtpHost || "");
        setSmtpPort(parsed.smtpPort || "587");
        setSmtpUser(parsed.smtpUser || "");
        setSmtpPass(parsed.smtpPass || "");
      }
    } catch {}
  }, []);

  const saveEmailSettings = () => {
    try {
      localStorage.setItem(
        EMAIL_SETTINGS_STORAGE_KEY,
        JSON.stringify({ targetEmail, smtpHost, smtpPort, smtpUser, smtpPass })
      );
      toast.success("Email Forwarding Settings Saved!");
      setEmailSettingsOpen(false);
    } catch {
      toast.error("Could not save settings.");
    }
  };

  // Switch mode helper
  const handleSwitchMode = (newMode: DocMode) => {
    setMode(newMode);
    if (newMode === "invoice") setItems(DEFAULT_INVOICE_ITEMS);
    else if (newMode === "quotation") setItems(DEFAULT_QUOTE_ITEMS);
    else if (newMode === "commercial") setItems(DEFAULT_COMMERCIAL_ITEMS);
    else setItems([]);
  };

  // Item helpers
  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        desc: "",
        hsn: "",
        qty: 1,
        unit: "Nos",
        price: 0,
        gst: 5,
      },
    ]);
  };

  const handleUpdateItem = (id: string, field: keyof ItemRow, val: string | number) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: val } : item))
    );
  };

  const handleRemoveItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  // Calculations
  const computedTotals = useMemo(() => {
    if (mode === "receipt") {
      return { taxable: 0, gstTotal: 0, grand: receiptAmount, netPayable: receiptAmount };
    }
    if (mode === "commercial") {
      const cap = parseFloat(capacityKwp) || 0;
      const rate = parseFloat(ratePerWp) || 0;
      const gstPct = parseFloat(commercialGst) || 0;
      const wp = cap * 1000;
      const base = wp * rate;
      const gstAmt = (base * gstPct) / 100;
      const grand = base + gstAmt;
      return { taxable: base, gstTotal: gstAmt, grand, netPayable: grand, wp, base, gstAmt };
    }

    const calculatedItems = items.map((i) => {
      const amount = i.qty * i.price;
      const gstAmt = (amount * i.gst) / 100;
      return { ...i, amount, gstAmt, total: amount + gstAmt };
    });

    const taxable = calculatedItems.reduce((s, i) => s + i.amount, 0);
    const gstTotal = calculatedItems.reduce((s, i) => s + i.gstAmt, 0);
    const grand = taxable + gstTotal;
    const netPayable = grand - (subsidyCentral || 0) - (subsidyState || 0);

    return { taxable, gstTotal, grand, netPayable, calculatedItems };
  }, [
    mode,
    items,
    receiptAmount,
    capacityKwp,
    ratePerWp,
    commercialGst,
    subsidyCentral,
    subsidyState,
  ]);

  // Auto fill rate per Wp for commercial
  const handleAutoFillCommercialRate = () => {
    const target = parseFloat(targetCommercialTotal);
    const cap = parseFloat(capacityKwp) || 0;
    const gstPct = parseFloat(commercialGst) || 0;
    if (!target || target <= 0) {
      toast.error("Pehle ek valid Target Gross Total bharein.");
      return;
    }
    if (cap <= 0) {
      toast.error("Pehle System Capacity (KWp) bharein.");
      return;
    }
    const wp = cap * 1000;
    const rate = target / (wp * (1 + gstPct / 100));
    setRatePerWp(rate.toFixed(2));
    toast.success("Rate per Wp Gross Total ke hisaab se fill ho gaya!");
  };

  // Auto fill prices from target grand total
  const handleAutoFillGrandTotal = () => {
    const target = parseFloat(targetGrandTotal);
    if (!target || target <= 0) {
      toast.error("Pehle ek valid Target Grand Total bharein.");
      return;
    }
    if (items.length === 0) {
      toast.error("Pehle kam se kam ek item add karein.");
      return;
    }

    const currentGrand = items.reduce(
      (s, i) => s + i.qty * i.price * (1 + i.gst / 100),
      0
    );

    if (currentGrand > 0) {
      const k = target / currentGrand;
      setItems((prev) =>
        prev.map((i) => ({
          ...i,
          price: parseFloat((i.price * k).toFixed(2)),
        }))
      );
    } else {
      const weightSum = items.reduce((s, i) => s + i.qty * (1 + i.gst / 100), 0);
      if (weightSum <= 0) {
        toast.error("Items mein Qty set karein pehle.");
        return;
      }
      const unitPrice = target / weightSum;
      setItems((prev) =>
        prev.map((i) => ({
          ...i,
          price: parseFloat(unitPrice.toFixed(2)),
        }))
      );
    }
    toast.success("Sab prices Grand Total ke hisaab se fill ho gaye!");
  };

  // Final Submit
  const handleFinalSubmit = () => {
    if (!custName.trim()) {
      toast.error("Please enter Customer Name.");
      return;
    }

    const dateStr = docDate
      ? new Date(docDate + "T00:00:00").toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })
      : new Date().toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });

    const newRecord: SavedRecord = {
      id: String(Date.now()),
      mode,
      docNo: docNo || "—",
      dateStr,
      custName,
      custPhone,
      custAddress,
      payMode,
      supplyType,
      branchAddress,
      branchPhone,
      items,
      savedGrandTotal: computedTotals.netPayable || computedTotals.grand,
      savedAt: Date.now(),
      subsidyCentral,
      subsidyState,
      validity,
      capacity: parseFloat(capacityKwp) || 0,
      technology,
      spaceRequired,
      application,
      rate: parseFloat(ratePerWp) || 0,
      gstPct: parseFloat(commercialGst) || 0,
      payAdvance: parseFloat(payAdvance) || 0,
      payDispatch: parseFloat(payDispatch) || 0,
      payInstall: parseFloat(payInstall) || 0,
      amount: receiptAmount,
      balance: receiptBalance,
      remarks: receiptRemarks,
      refInvoice,
    };

    setRecords((prev) => [newRecord, ...prev]);
    setActiveRecord(newRecord);
    setSendPhone(custPhone);
    setViewState("preview");
    toast.success("Document Generated Successfully!");
  };

  // Helper to load jspdf & html2canvas on demand
  const loadPdfLibraries = async () => {
    if (typeof window === "undefined") return null;
    const win = window as unknown as {
      jspdf?: { jsPDF: typeof import("jspdf").jsPDF };
      html2canvas?: typeof import("html2canvas").default;
    };
    if (win.jspdf && win.html2canvas) {
      return { jsPDF: win.jspdf.jsPDF, html2canvas: win.html2canvas };
    }

    try {
      if (!win.html2canvas) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
          s.onload = () => resolve(true);
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }

      if (!win.jspdf) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
          s.onload = () => resolve(true);
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }

      return { jsPDF: win.jspdf!.jsPDF, html2canvas: win.html2canvas! };
    } catch {
      return null;
    }
  };

  // Generate PDF Blob using Invoice (3).html exact 780px capture with injected CSS
  const generatePdfBlob = async () => {
    const libs = await loadPdfLibraries();
    const original = document.getElementById("docOutput");
    if (!libs || !original) return null;

    const clone = original.cloneNode(true) as HTMLElement;
    clone.style.width = "780px";
    clone.style.maxWidth = "780px";
    clone.style.position = "absolute";
    clone.style.left = "-9999px";
    clone.style.top = "0";
    clone.style.background = "#ffffff";

    const styleEl = document.createElement("style");
    styleEl.innerHTML = `
      .doc2 { border: 2px solid #000 !important; font-family: Calibri, Arial, sans-serif !important; color: #000 !important; font-size: 12px !important; background: #ffffff !important; }
      .doc2 table { width: 100% !important; border-collapse: collapse !important; }
      .doc2 td { border: 1px solid #000 !important; padding: 5px 8px !important; vertical-align: middle !important; font-size: 12px !important; }
      .doc2 .noB { border: none !important; }
      .doc2 .center { text-align: center !important; }
      .doc2 .right { text-align: right !important; }
      .doc2 .bold { font-weight: 700 !important; }
      .doc2 .big { font-size: 21px !important; font-weight: 800 !important; letter-spacing: 0.01em !important; }
      .doc2 .midtitle { font-size: 15px !important; font-weight: 800 !important; letter-spacing: 0.04em !important; }
      .doc2 .small { font-size: 10.5px !important; }
      .doc2 img.logo { width: 82px !important; display: block !important; margin: 0 auto !important; }
      .doc2 .sectionbar { font-size: 11.5px !important; font-weight: 700 !important; padding: 5px 8px !important; background: #ffffff !important; }
      .doc2 .italic { font-style: italic !important; }
      .doc2 .label { font-weight: 700 !important; width: 150px !important; }
      .doc2 .prose { font-size: 11.5px !important; line-height: 1.55 !important; padding: 8px 10px !important; }
      .doc2 .prose ul { margin: 6px 0 !important; padding-left: 20px !important; }
      .doc2 .prose li { margin-bottom: 4px !important; }
    `;
    clone.insertBefore(styleEl, clone.firstChild);
    document.body.appendChild(clone);

    const canvas = await libs.html2canvas(clone, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      width: 780,
      windowWidth: 780,
    });
    document.body.removeChild(clone);

    const imgData = canvas.toDataURL("image/png");
    const pdf = new libs.jsPDF("p", "mm", "a4");
    const pageWidth = 210,
      pageHeight = 297;
    const marginMM = 0.3 * 25.4;
    const usableWidth = pageWidth - marginMM * 2;
    const usableHeight = pageHeight - marginMM * 2;
    const imgWidth = usableWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = marginMM;

    pdf.addImage(imgData, "PNG", marginMM, position, imgWidth, imgHeight);
    heightLeft -= usableHeight;

    while (heightLeft > 0) {
      position = marginMM - (imgHeight - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, "PNG", marginMM, position, imgWidth, imgHeight);
      heightLeft -= usableHeight;
    }

    return { pdf, blob: pdf.output("blob") as Blob };
  };

  // Direct PDF Download + Auto Email Forward
  const handleDownloadPdf = async () => {
    toast.info("Generating A4 PDF Download...");
    try {
      const res = await generatePdfBlob();
      if (res?.pdf && res?.blob) {
        const docTitle =
          mode === "invoice"
            ? "Tax_Invoice"
            : mode === "quotation"
            ? "Quotation"
            : mode === "receipt"
            ? "Payment_Receipt"
            : "Commercial_Proposal";
        const filename = `StepSolar_${docTitle}_${docNo || "doc"}.pdf`;

        // Save PDF file to user device
        res.pdf.save(filename);
        toast.success("PDF Downloaded Successfully!");

        // Auto forward to target email if email settings are configured
        if (targetEmail.trim() && smtpUser.trim() && smtpPass.trim()) {
          toast.info(`Forwarding PDF copy to ${targetEmail}...`);
          try {
            const reader = new FileReader();
            reader.readAsDataURL(res.blob);
            reader.onloadend = async () => {
              const base64data = reader.result as string;
              await fetch("/api/invoices/email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  pdf_base64: base64data,
                  filename,
                  to_email: targetEmail,
                  smtp_host: smtpHost,
                  smtp_port: smtpPort,
                  smtp_user: smtpUser,
                  smtp_pass: smtpPass,
                  subject: `Step Solar - ${docTitle.replace(/_/g, " ")} (${custName})`,
                }),
              });
              toast.success(`PDF copy emailed to ${targetEmail}!`);
            };
          } catch {
            // best effort email forward
          }
        }
      } else {
        toast.error("PDF generation library not loaded.");
      }
    } catch {
      toast.error("Failed to generate PDF.");
    }
  };

  // Send WhatsApp Action with PDF document attached + fallback to text
  const handleSendWhatsAppApi = async () => {
    if (!sendPhone.trim()) {
      toast.error("Please enter a valid phone number.");
      return;
    }
    setSending(true);

    const docTitle =
      mode === "invoice"
        ? "Tax Invoice"
        : mode === "quotation"
        ? "Quotation"
        : mode === "receipt"
        ? "Payment Receipt"
        : "Commercial Quotation";

    const textContent = `⚡ *Step Solar Energy Pvt Ltd* ⚡
📄 *${docTitle.toUpperCase()}*

👤 *Customer:* ${custName}
📱 *Phone:* ${custPhone || sendPhone}
🔢 *${docTitle} No:* ${docNo || "—"}
💰 *Amount:* ${inr(computedTotals.netPayable || computedTotals.grand)}

Aapka document taiyar hai. Any queries, please call +91 ${branchPhone}.
Thank you for choosing Step Solar!`;

    try {
      toast.info("Preparing PDF Document & Uploading...");
      let mediaUrl: string | null = null;

      try {
        const pdfRes = await generatePdfBlob();
        if (pdfRes?.blob) {
          const pdfFileName = `StepSolar_${docTitle.replace(/\s+/g, "_")}_${docNo || "doc"}.pdf`;
          const pdfFile = new File([pdfRes.blob], pdfFileName, {
            type: "application/pdf",
          });
          const uploadRes = await uploadAccountMedia("chat-media", pdfFile);
          mediaUrl = uploadRes.publicUrl;
        }
      } catch (uploadErr) {
        console.warn("[Invoice] PDF upload error:", uploadErr);
      }

      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: sendPhone,
          customer_name: custName,
          message_type: mediaUrl ? "document" : "text",
          media_url: mediaUrl,
          filename: `StepSolar_${docTitle.replace(/\s+/g, "_")}_${docNo || "doc"}.pdf`,
          content_text: textContent,
        }),
      });

      const data = await res.json().catch(() => null);

      if (res.ok && (data?.success || data?.message_id)) {
        toast.success(
          mediaUrl
            ? "WhatsApp Message with PDF Sent Directly via WA CRM!"
            : "WhatsApp Message Sent Directly via WA CRM!"
        );
        setSendDialogOpen(false);
      } else {
        toast.error(
          data?.error || "Failed to send message via WA CRM API. Check WhatsApp connection."
        );
      }
    } catch (err) {
      console.error(err);
      toast.error("Error sending message via WA CRM API.");
    } finally {
      setSending(false);
    }
  };

  const handleForwardWhatsAppUrl = () => {
    if (!sendPhone.trim()) {
      toast.error("Please enter a valid phone number.");
      return;
    }
    const docTitle =
      mode === "invoice"
        ? "Tax Invoice"
        : mode === "quotation"
        ? "Quotation"
        : mode === "receipt"
        ? "Payment Receipt"
        : "Commercial Quotation";

    const textContent = `⚡ *Step Solar Energy Pvt Ltd* ⚡
📄 *${docTitle.toUpperCase()}*

👤 *Customer:* ${custName}
📱 *Phone:* ${custPhone || sendPhone}
🔢 *${docTitle} No:* ${docNo || "—"}
💰 *Amount:* ${inr(computedTotals.netPayable || computedTotals.grand)}

Aapka document taiyar hai. Any queries, please call +91 ${branchPhone}.
Thank you for choosing Step Solar!`;

    const cleanPhone = sendPhone.replace(/\D/g, "");
    const waUrl = `https://wa.me/91${cleanPhone}?text=${encodeURIComponent(textContent)}`;
    window.open(waUrl, "_blank");
    setSendDialogOpen(false);
  };

  const activeHtml = useMemo(() => {
    const recordToRender: SavedRecord = activeRecord || {
      id: "current",
      mode,
      docNo: docNo || "—",
      dateStr: docDate
        ? new Date(docDate + "T00:00:00").toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          })
        : new Date().toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          }),
      custName: custName || "—",
      custPhone: custPhone || "—",
      custAddress: custAddress || "—",
      payMode,
      supplyType,
      branchAddress,
      branchPhone,
      items,
      savedGrandTotal: computedTotals.netPayable || computedTotals.grand,
      savedAt: Date.now(),
      subsidyCentral,
      subsidyState,
      validity,
      capacity: parseFloat(capacityKwp) || 0,
      technology,
      spaceRequired,
      application,
      rate: parseFloat(ratePerWp) || 0,
      gstPct: parseFloat(commercialGst) || 0,
      payAdvance: parseFloat(payAdvance) || 0,
      payDispatch: parseFloat(payDispatch) || 0,
      payInstall: parseFloat(payInstall) || 0,
      amount: receiptAmount,
      balance: receiptBalance,
      remarks: receiptRemarks,
      refInvoice,
    };
    return renderDocHtml(recordToRender);
  }, [
    activeRecord,
    mode,
    docNo,
    docDate,
    custName,
    custPhone,
    custAddress,
    payMode,
    supplyType,
    branchAddress,
    branchPhone,
    items,
    computedTotals,
    subsidyCentral,
    subsidyState,
    validity,
    capacityKwp,
    technology,
    spaceRequired,
    application,
    ratePerWp,
    commercialGst,
    payAdvance,
    payDispatch,
    payInstall,
    receiptAmount,
    receiptBalance,
    receiptRemarks,
    refInvoice,
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      {/* Exact-Replica Styles from Invoice (3).html */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .doc2 {
          border: 2px solid #000;
          font-family: Calibri, Arial, sans-serif;
          color: #000;
          font-size: 12px;
          background: #ffffff;
        }
        .doc2 table {
          width: 100%;
          border-collapse: collapse;
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .doc2 td {
          border: 1px solid #000;
          padding: 5px 8px;
          vertical-align: middle;
          font-size: 12px;
        }
        .doc2 .noB {
          border: none;
        }
        .doc2 .center {
          text-align: center;
        }
        .doc2 .right {
          text-align: right;
        }
        .doc2 .bold {
          font-weight: 700;
        }
        .doc2 .big {
          font-size: 21px;
          font-weight: 800;
          letter-spacing: 0.01em;
        }
        .doc2 .midtitle {
          font-size: 15px;
          font-weight: 800;
          letter-spacing: 0.04em;
        }
        .doc2 .small {
          font-size: 10.5px;
        }
        .doc2 img.logo {
          width: 82px;
          display: block;
          margin: 0 auto;
        }
        .doc2 .sectionbar {
          font-size: 11.5px;
          font-weight: 700;
          padding: 5px 8px;
          background: #ffffff;
        }
        .doc2 .italic {
          font-style: italic;
        }
        .doc2 .label {
          font-weight: 700;
          width: 150px;
        }
        .doc2 .prose {
          font-size: 11.5px;
          line-height: 1.55;
          padding: 8px 10px;
        }
        .doc2 .prose ul {
          margin: 6px 0;
          padding-left: 20px;
        }
        .doc2 .prose li {
          margin-bottom: 4px;
        }
      `,
        }}
      />

      {/* Top Header & Mode Switcher */}
      <div className="no-print flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground">
              ⚡ Step Solar — Document Generator
            </h1>
            <p className="text-xs text-muted-foreground">
              Generate Tax Invoice, Quotation, Payment Receipt & Commercial Proposals
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEmailSettingsOpen(true)}
              className="gap-1.5"
            >
              <Settings className="h-4 w-4" />
              Email Settings
            </Button>
            <Button
              variant={viewState === "records" ? "secondary" : "outline"}
              size="sm"
              onClick={() => setViewState(viewState === "records" ? "form" : "records")}
            >
              <FolderOpen className="h-4 w-4" />
              Saved Records ({records.length})
            </Button>
          </div>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="flex flex-wrap gap-2 rounded-lg bg-muted p-1">
          <Button
            variant={mode === "invoice" ? "default" : "ghost"}
            size="sm"
            onClick={() => handleSwitchMode("invoice")}
            className="flex-1 text-xs"
          >
            Tax Invoice
          </Button>
          <Button
            variant={mode === "quotation" ? "default" : "ghost"}
            size="sm"
            onClick={() => handleSwitchMode("quotation")}
            className="flex-1 text-xs"
          >
            Quotation
          </Button>
          <Button
            variant={mode === "receipt" ? "default" : "ghost"}
            size="sm"
            onClick={() => handleSwitchMode("receipt")}
            className="flex-1 text-xs"
          >
            Payment Receipt
          </Button>
          <Button
            variant={mode === "commercial" ? "default" : "ghost"}
            size="sm"
            onClick={() => handleSwitchMode("commercial")}
            className="flex-1 text-xs"
          >
            Commercial Proposal
          </Button>
        </div>
      </div>

      {/* VIEW: Saved Records */}
      {viewState === "records" && (
        <Card className="no-print">
          <CardHeader>
            <CardTitle className="text-lg">Saved Documents</CardTitle>
            <CardDescription>
              All documents generated during this session
            </CardDescription>
          </CardHeader>
          <CardContent>
            {records.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No saved documents yet. Fill the form and click "Generate Document".
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-muted-foreground">
                      <th className="p-3">Type</th>
                      <th className="p-3">Doc No</th>
                      <th className="p-3">Date</th>
                      <th className="p-3">Customer</th>
                      <th className="p-3 text-right">Amount</th>
                      <th className="p-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((rec) => (
                      <tr key={rec.id} className="border-b border-border hover:bg-muted/30">
                        <td className="p-3 font-semibold uppercase">{rec.mode}</td>
                        <td className="p-3">{rec.docNo}</td>
                        <td className="p-3">{rec.dateStr}</td>
                        <td className="p-3">{rec.custName}</td>
                        <td className="p-3 text-right font-medium">{inr(rec.savedGrandTotal)}</td>
                        <td className="p-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setActiveRecord(rec);
                              setMode(rec.mode);
                              setViewState("preview");
                            }}
                          >
                            View / Print
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setViewState("form")}>
                <ArrowLeft className="h-4 w-4" />
                Back to Editor
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* VIEW: Editor Form */}
      {viewState === "form" && (
        <div className="no-print flex flex-col gap-5">
          {/* Company & Customer Details */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Company & Customer Details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Branch Address</Label>
                <Input
                  value={branchAddress}
                  onChange={(e) => setBranchAddress(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Company Phone</Label>
                <Input
                  value={branchPhone}
                  onChange={(e) => setBranchPhone(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <div className="h-px bg-border my-1" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Customer Name *</Label>
                <Input
                  placeholder="e.g. Anita Sonkar"
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Contact No.</Label>
                <Input
                  placeholder="10-digit mobile number"
                  value={custPhone}
                  onChange={(e) => setCustPhone(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">
                  {mode === "invoice" ? "Place of Supply / Address" : "Customer Address"}
                </Label>
                <Input
                  placeholder="Full customer address"
                  value={custAddress}
                  onChange={(e) => setCustAddress(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">
                  {mode === "invoice"
                    ? "Invoice No."
                    : mode === "quotation"
                    ? "Quotation No."
                    : mode === "receipt"
                    ? "Receipt No."
                    : "Ref No."}
                </Label>
                <Input
                  placeholder="e.g. 20"
                  value={docNo}
                  onChange={(e) => setDocNo(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Date</Label>
                <Input
                  type="date"
                  value={docDate}
                  onChange={(e) => setDocDate(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              {(mode === "invoice" || mode === "receipt") && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Payment Mode</Label>
                  <Select value={payMode} onValueChange={setPayMode}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Online">Online</SelectItem>
                      <SelectItem value="Cash">Cash</SelectItem>
                      <SelectItem value="Cheque">Cheque</SelectItem>
                      <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs">GST Type (Supply)</Label>
                <Select value={supplyType} onValueChange={setSupplyType}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="igst">IGST — Inter-State (e.g. Bihar, Other States)</SelectItem>
                    <SelectItem value="cgst_sgst">CGST + SGST — Intra-State (U.P. Only)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {mode === "receipt" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Received Against (Invoice / Quotation No.)</Label>
                  <Input
                    placeholder="e.g. Invoice #20"
                    value={refInvoice}
                    onChange={(e) => setRefInvoice(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
              )}

              {mode === "commercial" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Proposal Validity (Days)</Label>
                  <Input
                    type="number"
                    value={validity}
                    onChange={(e) => setValidity(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Mode Specific: Commercial Overview */}
          {mode === "commercial" && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Project Overview (Commercial)</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">System Capacity (KWp)</Label>
                  <Input
                    type="number"
                    placeholder="e.g. 50.40"
                    value={capacityKwp}
                    onChange={(e) => setCapacityKwp(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Technology</Label>
                  <Input
                    placeholder="e.g. Non DCR Topcon Bifacial High Efficiency Modules"
                    value={technology}
                    onChange={(e) => setTechnology(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Space Required</Label>
                  <Input
                    placeholder="e.g. Approx 4,000 Sq. Ft."
                    value={spaceRequired}
                    onChange={(e) => setSpaceRequired(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Application</Label>
                  <Input
                    placeholder="e.g. Industrial On-Grid Solar"
                    value={application}
                    onChange={(e) => setApplication(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Rate per Wp (₹)</Label>
                  <Input
                    type="number"
                    placeholder="e.g. 25.87"
                    value={ratePerWp}
                    onChange={(e) => setRatePerWp(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">GST %</Label>
                  <Input
                    type="number"
                    value={commercialGst}
                    onChange={(e) => setCommercialGst(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2 border-t border-dashed border-border pt-3">
                  <Label className="text-xs font-semibold">
                    Target Gross Total (₹) — Auto-calculate Rate per Wp
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      placeholder="e.g. 1420000"
                      value={targetCommercialTotal}
                      onChange={(e) => setTargetCommercialTotal(e.target.value)}
                      className="h-9 text-xs"
                    />
                    <Button
                      size="sm"
                      onClick={handleAutoFillCommercialRate}
                      className="gap-1 text-xs"
                    >
                      <Zap className="h-3.5 w-3.5" />
                      Auto-fill
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5 sm:col-span-2 border-t border-dashed border-border pt-3">
                  <Label className="text-xs font-semibold">Payment Schedule (%)</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-[10px]">PO Advance %</Label>
                      <Input
                        type="number"
                        value={payAdvance}
                        onChange={(e) => setPayAdvance(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Before Dispatch %</Label>
                      <Input
                        type="number"
                        value={payDispatch}
                        onChange={(e) => setPayDispatch(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">After Install %</Label>
                      <Input
                        type="number"
                        value={payInstall}
                        onChange={(e) => setPayInstall(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Mode Specific: Receipt Amount */}
          {mode === "receipt" && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Payment Details</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Amount Received (₹)</Label>
                  <Input
                    type="number"
                    value={receiptAmount}
                    onChange={(e) => setReceiptAmount(parseFloat(e.target.value) || 0)}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Balance Due (₹, optional)</Label>
                  <Input
                    type="number"
                    value={receiptBalance}
                    onChange={(e) => setReceiptBalance(parseFloat(e.target.value) || 0)}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs">Remarks (optional)</Label>
                  <Input
                    placeholder="e.g. Advance payment for 5KW solar installation"
                    value={receiptRemarks}
                    onChange={(e) => setReceiptRemarks(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Items Table Section */}
          {mode !== "receipt" && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {mode === "invoice"
                      ? "Item Description"
                      : mode === "commercial"
                      ? "Bill of Materials (BOM) & Specifications"
                      : "Technical Specifications & Scope of Supply"}
                  </CardTitle>
                  <Button size="sm" variant="outline" onClick={handleAddItem} className="gap-1 text-xs">
                    <Plus className="h-3.5 w-3.5" />
                    Add Item
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                        <th className="p-2 min-w-[200px]">Description</th>
                        <th className="p-2 min-w-[100px]">
                          {mode === "invoice" ? "HSN/SAC" : "Spec / Make"}
                        </th>
                        <th className="p-2 w-[70px]">Qty</th>
                        <th className="p-2 w-[80px]">Unit</th>
                        {(mode === "invoice" || mode === "quotation" || mode === "receipt") && (
                          <>
                            <th className="p-2 w-[110px]">Price/Unit (₹)</th>
                            <th className="p-2 w-[70px]">GST %</th>
                          </>
                        )}
                        <th className="p-2 w-[40px]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id} className="border-b border-border">
                          <td className="p-1.5">
                            <Input
                              value={item.desc}
                              onChange={(e) => handleUpdateItem(item.id, "desc", e.target.value)}
                              className="h-8 text-xs"
                            />
                          </td>
                          <td className="p-1.5">
                            <Input
                              value={item.hsn}
                              onChange={(e) => handleUpdateItem(item.id, "hsn", e.target.value)}
                              className="h-8 text-xs"
                            />
                          </td>
                          <td className="p-1.5">
                            <Input
                              type="number"
                              value={item.qty}
                              onChange={(e) => handleUpdateItem(item.id, "qty", parseFloat(e.target.value) || 0)}
                              className="h-8 text-xs"
                            />
                          </td>
                          <td className="p-1.5">
                            <Input
                              value={item.unit}
                              onChange={(e) => handleUpdateItem(item.id, "unit", e.target.value)}
                              className="h-8 text-xs"
                            />
                          </td>
                          {(mode === "invoice" || mode === "quotation" || mode === "receipt") && (
                            <>
                              <td className="p-1.5">
                                <Input
                                  type="number"
                                  value={item.price}
                                  onChange={(e) => handleUpdateItem(item.id, "price", parseFloat(e.target.value) || 0)}
                                  className="h-8 text-xs"
                                />
                              </td>
                              <td className="p-1.5">
                                <Input
                                  type="number"
                                  value={item.gst}
                                  onChange={(e) => handleUpdateItem(item.id, "gst", parseFloat(e.target.value) || 0)}
                                  className="h-8 text-xs"
                                />
                              </td>
                            </>
                          )}
                          <td className="p-1.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveItem(item.id)}
                              className="h-8 w-8 text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mode Specific: Quotation Subsidy (Exact Layout from Image) */}
                {mode === "quotation" && (
                  <div className="space-y-3 border-t border-dashed border-border pt-3">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      GOVERNMENT SUBSIDY (QUOTATION ONLY)
                    </Label>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Central Government Subsidy (₹)</Label>
                        <Input
                          type="number"
                          value={subsidyCentral}
                          onChange={(e) => setSubsidyCentral(parseFloat(e.target.value) || 0)}
                          className="h-9 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">State Government Subsidy (₹)</Label>
                        <Input
                          type="number"
                          value={subsidyState}
                          onChange={(e) => setSubsidyState(parseFloat(e.target.value) || 0)}
                          className="h-9 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Auto Totals & Auto-fill */}
                <div className="flex flex-col gap-3 rounded-lg bg-muted/40 p-4 border border-border">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    AUTO-CALCULATED TOTALS
                  </Label>
                  <div className="flex flex-col gap-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Taxable Amount:</span>
                      <span className="font-medium">{inr(computedTotals.taxable)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total GST:</span>
                      <span className="font-medium">{inr(computedTotals.gstTotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold text-foreground border-t border-border pt-1 mt-1">
                      <span>Grand Total:</span>
                      <span>{inr(computedTotals.grand)}</span>
                    </div>
                    {mode === "quotation" && (
                      <>
                        <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                          <span>Less: Central Govt. Subsidy:</span>
                          <span>−{inr(subsidyCentral || 0)}</span>
                        </div>
                        <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                          <span>Less: State Govt. Subsidy:</span>
                          <span>−{inr(subsidyState || 0)}</span>
                        </div>
                        <div className="flex justify-between text-sm font-bold text-foreground border-t-2 border-primary pt-1 mt-1">
                          <span>Net Payable (After Subsidy):</span>
                          <span>{inr(computedTotals.netPayable)}</span>
                        </div>
                      </>
                    )}
                  </div>

                  {(mode === "invoice" || mode === "quotation" || mode === "receipt") && (
                    <div className="space-y-1.5 border-t border-dashed border-border pt-3">
                      <Label className="text-xs font-semibold">
                        Target Grand Total (₹) — Auto-calculate item prices
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          placeholder="e.g. 190000"
                          value={targetGrandTotal}
                          onChange={(e) => setTargetGrandTotal(e.target.value)}
                          className="h-8 text-xs"
                        />
                        <Button
                          size="sm"
                          onClick={handleAutoFillGrandTotal}
                          className="gap-1 text-xs"
                        >
                          <Zap className="h-3.5 w-3.5" />
                          Auto-fill
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Bottom Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
            <Button variant="outline" size="sm" onClick={() => handleSwitchMode(mode)}>
              <RotateCcw className="h-4 w-4" />
              Reset Form
            </Button>
            <Button onClick={handleFinalSubmit} className="gap-2 font-semibold">
              <CheckCircle2 className="h-4 w-4" />
              Final Submit & Generate Document
            </Button>
          </div>
        </div>
      )}

      {/* VIEW: Document Preview / Output (Exact Replica from Invoice (3).html) */}
      {viewState === "preview" && (
        <div className="flex flex-col gap-4">
          {/* Action Header for Preview — ONLY Download PDF and Send via WhatsApp */}
          <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
            <Button variant="outline" size="sm" onClick={() => setViewState("form")}>
              <ArrowLeft className="h-4 w-4" />
              Edit Form Again
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={handleDownloadPdf}
                className="gap-1.5"
              >
                <Download className="h-4 w-4" />
                Download PDF (A4)
              </Button>
              <Button
                size="sm"
                onClick={() => setSendDialogOpen(true)}
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Send className="h-4 w-4" />
                Send via WhatsApp
              </Button>
            </div>
          </div>

          {/* Printable Document Box Container (Exact Replica from Invoice (3).html) */}
          <Card className="overflow-hidden border border-border shadow-lg bg-white text-black p-4 sm:p-6">
            <div className="docwrap">
              <div
                className="doc2"
                id="docOutput"
                dangerouslySetInnerHTML={{ __html: activeHtml }}
              />
            </div>
          </Card>
        </div>
      )}

      {/* DIALOG: Email Forwarding Settings */}
      <Dialog open={emailSettingsOpen} onOpenChange={setEmailSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              Email Forwarding Settings
            </DialogTitle>
            <DialogDescription>
              Configure SMTP credentials to automatically email PDF copies when documents are downloaded.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs">Target Forward Email Address</Label>
              <Input
                placeholder="e.g. sales@stepsolar.in"
                value={targetEmail}
                onChange={(e) => setTargetEmail(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">SMTP Host</Label>
                <Input
                  placeholder="e.g. smtp.gmail.com"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">SMTP Port</Label>
                <Input
                  placeholder="587"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">SMTP User / Email</Label>
              <Input
                placeholder="e.g. sales@stepsolar.in"
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">SMTP App Password</Label>
              <Input
                type="password"
                placeholder="App password"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <DialogFooter className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEmailSettingsOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={saveEmailSettings}>
              Save Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG: Send via WhatsApp */}
      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5 text-emerald-500" />
              Send Document via WhatsApp
            </DialogTitle>
            <DialogDescription>
              Enter the recipient's WhatsApp Phone Number below to send or forward the document with PDF attached.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">WhatsApp Phone Number *</Label>
              <Input
                placeholder="10-digit mobile number e.g. 9519956600"
                value={sendPhone}
                onChange={(e) => setSendPhone(e.target.value)}
                className="h-9 text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                Customer Name: <strong>{custName || "Customer"}</strong>
              </p>
            </div>
          </div>

          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleForwardWhatsAppUrl}
              className="gap-1.5 border-emerald-500/40 text-emerald-600 hover:bg-emerald-50 text-xs"
            >
              <Send className="h-3.5 w-3.5" />
              Forward in WhatsApp App
            </Button>
            <Button
              size="sm"
              onClick={handleSendWhatsAppApi}
              disabled={sending}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {sending ? "Sending via WA CRM..." : "Send Direct via WA CRM"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
