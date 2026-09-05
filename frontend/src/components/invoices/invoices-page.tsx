"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, RefreshCw, Send } from "lucide-react";
import { format } from "date-fns";

type Invoice = {
  id: string;
  invoice_no: string;
  contact_phone?: string;
  customer_name?: string;
  amount?: number;
  status?: string;
  file_path?: string;
  created_at?: string;
};

export function InvoicesPageContent() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("invoices")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      setActionMsg("Error fetching invoices: " + error.message);
    } else {
      setInvoices((data as Invoice[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchInvoices();
  }, [fetchInvoices]);

  async function viewPdf(filePath: string) {
    setActionMsg("Generating preview URL...");
    const res = await fetch("/api/invoices/signed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ object_path: filePath }),
    });
    const data = await res.json();
    const signed =
      data.signedURL ||
      data.signedUrl ||
      data.signed_url ||
      data.publicURL ||
      data?.url;
    if (res.ok && signed) {
      setActionMsg(null);
      window.open(signed, "_blank");
    } else {
      setActionMsg("Could not obtain signed URL");
    }
  }

  async function approveAndSend(invoice: Invoice) {
    setBusyId(invoice.id);
    setActionMsg("Approving and sending invoice...");
    const res = await fetch("/api/proxy/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoice_id: invoice.invoice_no }),
    });
    const data = await res.json();
    setBusyId(null);
    if (res.ok) {
      setActionMsg("Invoice sent.");
      void fetchInvoices();
    } else {
      setActionMsg("Error sending invoice: " + JSON.stringify(data));
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Invoices</h2>
          <p className="text-sm text-muted-foreground">
            Review quotation drafts, preview PDFs, and approve WhatsApp sends.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void fetchInvoices()}
          disabled={loading}
        >
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh
        </Button>
      </div>

      {actionMsg && (
        <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          {actionMsg}
        </p>
      )}

      {loading && invoices.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading invoices...
        </div>
      ) : invoices.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
          <FileText className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">No invoices yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Drafts appear here when a customer asks for a quotation or invoice
            on WhatsApp.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {invoices.map((inv) => {
            const status = (inv.status ?? "draft").toLowerCase();
            return (
              <li
                key={inv.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">
                      {inv.invoice_no}
                    </p>
                    <Badge
                      variant="outline"
                      className={
                        status === "sent"
                          ? "border-primary/40 text-primary"
                          : status === "paid"
                            ? "border-emerald-500/40 text-emerald-400"
                            : "border-amber-500/40 text-amber-400"
                      }
                    >
                      {status}
                    </Badge>
                  </div>
                  <p className="truncate text-sm text-muted-foreground">
                    {inv.customer_name || inv.contact_phone || "Unknown customer"}
                  </p>
                  <p className="mt-1 text-sm text-foreground">
                    ₹ {Number(inv.amount ?? 0).toFixed(2)}
                    {inv.created_at ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {format(new Date(inv.created_at), "dd MMM yyyy HH:mm")}
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {inv.file_path ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void viewPdf(inv.file_path!)}
                    >
                      <FileText className="h-4 w-4" />
                      View PDF
                    </Button>
                  ) : (
                    <span className="self-center text-xs text-muted-foreground">
                      No file
                    </span>
                  )}
                  {status === "draft" && (
                    <Button
                      size="sm"
                      onClick={() => void approveAndSend(inv)}
                      disabled={busyId === inv.id}
                    >
                      {busyId === inv.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Approve & Send
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
