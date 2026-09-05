"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
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
  FileText,
  Send,
  Download,
  Printer,
  Plus,
  Trash2,
  Zap,
  RotateCcw,
  ArrowLeft,
  Share2,
  CheckCircle2,
  Loader2,
  FolderOpen,
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
}

const LOGO_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAADNCAYAAAACEk3mAAD430lEQVR42uz9d5xc13Xni37X3uecCp3RjZwzSAAkmCVSFCWKlqxoyZIl2SNZHo/Tu55w38xngiddv/vm+r17Z+aOx+M4ziPLVg5WjhRJiRmJIAgiByJndKyqc/Ze94+9q7oa6AbRJECCHh586tONRqH6nB3WXuu3fuu3RFWV16/Xr9ev16/XwGVeH4LXr9ev16/XDdbr1+vX69fr1+sG6/Xr9ev163WD9fr1+vX69fp1nV/J9XdL2vadXKXPkpfwzuZvl7+jU+8nfbb2MZeLxuflZmfkikdTL/pf/zNdOvFbAVTGh0LbvnKVv+dlfr5Mspl0iinUlza9yfU3WY24nQyK4LEoMuG5ZIqlPfEq2kbLvOjoNDdq87caPIoiml5kxuLf5LW+KYqLHG2JP1XAIGowEh9TIZepzF7R9inmRQ1W4gtEBRVBjG39Xt8yaNoyj9J2b//z2Cs/ycYOa7iVz5/q68v6Xl/+ZzTvdZJ/U/Fxfg2tCQew0zz0ri9aQ/uTgLY9uWgRlrPEzaUGVcWQT2K2BPVJo8ymp5kxuLf5LW+KYqLHG2JP1XAIGowEh9TIZepzF7R9inmRQ1W4gtEBRVBjG39Xt8yaNoyj9J2b//z2Cs/ycYOa7iVz5/q68v6Xl/+ZzTvdZJ/U/Fxfg2tCQew0zz0ri9aQ/uTgLY9uWgRlrPEzaUGVcWQT2K2BPVJo8ymp5kxuLf5LW+KYqLHG2JP1XAIGowEh9TIZepzF7R9inmRQ1W4gtEBRVBjG39Xt8yaNoyj9J2b//z2Cs/ycYOa7iVz5/q68v6Xl/+ZzTvdZJ/U/Fxfg2tCQew0zz0ri9aQ/uTgLY9uWgRlrPEzaUGVcWQT2K2BPVJo8ymp5kxuLf5LW+KYqLHG2JP1XAIGowEh9TIZepzF7R9inmRQ1W4gtEBRVBjG39Xt8yaNoyj9J2b//z2Cs/ycYOa7iVz5/q68v6Xl/+ZzTvdZJ/U/Fxfg2tCQew0zz0ri9aQ/uTgLY9uWgRlrPEzaUGVcWQT2K2BPV";

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
  { id: "1", desc: "Solar Module (Bifacial DCR)", hsn: "590 WP (TATA)", qty: 5, unit: "Nos.", price: 0, gst: 5 },
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

  // Quotation specific
  const [subsidyCentral, setSubsidyCentral] = useState(0);
  const [subsidyState, setSubsidyState] = useState(0);

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

  // Send Dialog State
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendPhone, setSendPhone] = useState("");
  const [sending, setSending] = useState(false);

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
    };

    setRecords((prev) => [newRecord, ...prev]);
    setSendPhone(custPhone);
    setViewState("preview");
    toast.success("Document Generated Successfully!");
  };

  // Print & PDF
  const handlePrintPdf = () => {
    window.print();
  };

  // Send WhatsApp Action
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
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_id: null,
          conversation_id: null,
          message_type: "text",
          content_text: textContent,
        }),
      });

      if (res.ok) {
        toast.success("WhatsApp Message Sent Directly!");
        setSendDialogOpen(false);
      } else {
        // Fallback open WhatsApp link directly
        const cleanPhone = sendPhone.replace(/\D/g, "");
        const waUrl = `https://wa.me/91${cleanPhone}?text=${encodeURIComponent(textContent)}`;
        window.open(waUrl, "_blank");
        toast.success("Opening WhatsApp for direct message...");
        setSendDialogOpen(false);
      }
    } catch {
      const cleanPhone = sendPhone.replace(/\D/g, "");
      const waUrl = `https://wa.me/91${cleanPhone}?text=${encodeURIComponent(textContent)}`;
      window.open(waUrl, "_blank");
      toast.success("Opening WhatsApp...");
      setSendDialogOpen(false);
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

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
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
                              setCustName(rec.custName);
                              setCustPhone(rec.custPhone);
                              setCustAddress(rec.custAddress);
                              setDocNo(rec.docNo);
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
                        {(mode === "invoice" || mode === "receipt") && (
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
                          {(mode === "invoice" || mode === "receipt") && (
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

                {/* Mode Specific: Quotation Subsidy */}
                {mode === "quotation" && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 border-t border-dashed border-border pt-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Central Government Subsidy (₹)</Label>
                      <Input
                        type="number"
                        value={subsidyCentral}
                        onChange={(e) => setSubsidyCentral(parseFloat(e.target.value) || 0)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">State Government Subsidy (₹)</Label>
                      <Input
                        type="number"
                        value={subsidyState}
                        onChange={(e) => setSubsidyState(parseFloat(e.target.value) || 0)}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                )}

                {/* Auto Totals & Auto-fill */}
                <div className="flex flex-col gap-3 rounded-lg bg-muted/40 p-4 border border-border">
                  <div className="flex flex-col gap-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Taxable Subtotal:</span>
                      <span className="font-medium">{inr(computedTotals.taxable)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total GST:</span>
                      <span className="font-medium">{inr(computedTotals.gstTotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold text-foreground border-t border-border pt-1 mt-1">
                      <span>Grand Total:</span>
                      <span>{inr(computedTotals.netPayable || computedTotals.grand)}</span>
                    </div>
                  </div>

                  {(mode === "invoice" || mode === "receipt") && (
                    <div className="space-y-1.5 border-t border-dashed border-border pt-3">
                      <Label className="text-xs font-semibold">
                        Target Grand Total (₹) — Auto-calculate item prices
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          placeholder="e.g. 187000"
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

      {/* VIEW: Document Preview / Output */}
      {viewState === "preview" && (
        <div className="flex flex-col gap-4">
          {/* Action Header for Preview */}
          <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
            <Button variant="outline" size="sm" onClick={() => setViewState("form")}>
              <ArrowLeft className="h-4 w-4" />
              Edit Form Again
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={handlePrintPdf}>
                <Printer className="h-4 w-4" />
                Print / Download PDF (A4)
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

          {/* Printable Document Box */}
          <Card className="overflow-hidden border border-border shadow-lg bg-white text-black p-6 sm:p-8">
            <div className="doc2-wrapper text-[12px] leading-snug font-sans space-y-4">
              {/* Document Header */}
              <div className="border-2 border-black p-3 space-y-2">
                <div className="flex items-center justify-between border-b-2 border-black pb-2">
                  <div className="flex items-center gap-3">
                    <img src="/step-solar-logo.jpg" alt="Logo" className="h-12 w-12 object-contain" />
                    <div>
                      <h2 className="text-lg font-black tracking-wide uppercase">
                        STEP SOLAR ENERGY PVT. LTD.
                      </h2>
                      <p className="text-[11px] font-semibold text-gray-700">
                        Address: {branchAddress} | Phone: {branchPhone}
                      </p>
                      <p className="text-[11px] font-bold text-gray-800">
                        GSTIN: 09ABPCS3779K1ZC
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="inline-block bg-black text-white text-xs font-bold uppercase px-3 py-1 rounded">
                      {mode === "invoice"
                        ? "Tax Invoice"
                        : mode === "quotation"
                        ? "Quotation"
                        : mode === "receipt"
                        ? "Payment Receipt"
                        : "Commercial Proposal"}
                    </span>
                  </div>
                </div>

                {/* Customer & Document Details Grid */}
                <div className="grid grid-cols-2 gap-2 text-[11px] border-b border-black pb-2">
                  <div>
                    <p><strong>Customer Name:</strong> {custName || "—"}</p>
                    <p><strong>Contact No:</strong> {custPhone || "—"}</p>
                    <p><strong>Address:</strong> {custAddress || "—"}</p>
                  </div>
                  <div className="text-right">
                    <p><strong>{mode === "invoice" ? "Invoice" : "Ref"} No:</strong> {docNo || "—"}</p>
                    <p>
                      <strong>Date:</strong>{" "}
                      {docDate
                        ? new Date(docDate + "T00:00:00").toLocaleDateString("en-GB")
                        : new Date().toLocaleDateString("en-GB")}
                    </p>
                    <p><strong>Payment Mode:</strong> {payMode}</p>
                  </div>
                </div>

                {/* Items Table */}
                {mode !== "receipt" && (
                  <div className="overflow-x-auto my-2">
                    <table className="w-full border-collapse border border-black text-[11px]">
                      <thead>
                        <tr className="bg-gray-100 font-bold text-center border-b border-black">
                          <th className="border border-black p-1">S.N.</th>
                          <th className="border border-black p-1 text-left">Item Description</th>
                          <th className="border border-black p-1">HSN/Spec</th>
                          <th className="border border-black p-1">Qty</th>
                          <th className="border border-black p-1">Unit</th>
                          {(mode === "invoice" || mode === "receipt") && (
                            <>
                              <th className="border border-black p-1 text-right">Price/Unit</th>
                              <th className="border border-black p-1">GST %</th>
                              <th className="border border-black p-1 text-right">GST Amt</th>
                              <th className="border border-black p-1 text-right">Amount</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, idx) => {
                          const amt = item.qty * item.price;
                          const gstAmt = (amt * item.gst) / 100;
                          return (
                            <tr key={item.id} className="border-b border-black">
                              <td className="border border-black p-1 text-center">{idx + 1}</td>
                              <td className="border border-black p-1">{item.desc}</td>
                              <td className="border border-black p-1 text-center">{item.hsn || "-"}</td>
                              <td className="border border-black p-1 text-center">{item.qty}</td>
                              <td className="border border-black p-1 text-center">{item.unit}</td>
                              {(mode === "invoice" || mode === "receipt") && (
                                <>
                                  <td className="border border-black p-1 text-right">{inr(item.price)}</td>
                                  <td className="border border-black p-1 text-center">{item.gst}%</td>
                                  <td className="border border-black p-1 text-right">{inr(gstAmt)}</td>
                                  <td className="border border-black p-1 text-right">{inr(amt + gstAmt)}</td>
                                </>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Amount in Words & Totals Summary */}
                <div className="border border-black p-2 flex justify-between items-center bg-gray-50 text-[11px]">
                  <div>
                    <p className="font-bold">Amount in Words:</p>
                    <p className="italic text-gray-800">
                      {numberToWordsIndian(computedTotals.netPayable || computedTotals.grand)} Rupees Only
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">
                      Grand Total: {inr(computedTotals.netPayable || computedTotals.grand)}
                    </p>
                  </div>
                </div>

                {/* Bank Details & Terms */}
                <div className="grid grid-cols-2 gap-2 text-[10px] border-t border-black pt-2 mt-2">
                  <div>
                    <p className="font-bold border-b border-black pb-0.5">Bank Account Details for Payments:</p>
                    <p><strong>Account Name:</strong> STEP SOLAR ENERGY PVT LTD</p>
                    <p><strong>Bank Name:</strong> State Bank of India</p>
                    <p><strong>Account No:</strong> 44347774983</p>
                    <p><strong>IFSC Code:</strong> SBIN0064874</p>
                    <p><strong>Branch:</strong> Bhadaura</p>
                  </div>
                  <div className="text-right flex flex-col justify-between">
                    <div>
                      <p className="font-bold">For STEP SOLAR ENERGY PVT. LTD.</p>
                    </div>
                    <div className="pt-8">
                      <p className="font-bold">Authorized Signatory</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* DIALOG: Send via WhatsApp */}
      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5 text-emerald-500" />
              Send Document via WhatsApp
            </DialogTitle>
            <DialogDescription>
              Enter the recipient's WhatsApp Phone Number below to send or forward the document.
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
              Send Direct via WA CRM
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
