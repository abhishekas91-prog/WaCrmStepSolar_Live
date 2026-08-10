"use client";

import React, { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

type Invoice = any;

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchInvoices()
  }, [])

  async function fetchInvoices() {
    setLoading(true)
    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) {
      setActionMsg('Error fetching invoices: ' + error.message)
    } else {
      setInvoices(data as any)
    }
    setLoading(false)
  }

  async function viewPdf(filePath: string) {
    setActionMsg('Generating preview URL...')
    const res = await fetch('/api/invoices/signed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ object_path: filePath }),
    })
    const data = await res.json()
    if (res.ok && (data.signedURL || data.signedUrl || data.signed_url || data.signedUrl)) {
      const signed = data.signedURL || data.signedUrl || data.signed_url
      window.open(signed, '_blank')
    } else if (res.ok && data) {
      // Some Supabase deployments return { publicURL: ... }
      const possible = data.signedURL || data.signedUrl || data.signed_url || data.publicURL || data?.url
      if (possible) window.open(possible, '_blank')
      else setActionMsg('Could not obtain signed URL')
    } else {
      setActionMsg('Failed to get signed URL: ' + JSON.stringify(data))
    }
  }

  async function approveAndSend(invoice: Invoice) {
    setActionMsg('Approving and sending invoice...')
    const res = await fetch('/api/proxy/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoice_id: invoice.invoice_no }),
    })
    const data = await res.json()
    if (res.ok) {
      setActionMsg('Invoice sent. Refreshing...')
      fetchInvoices()
    } else {
      setActionMsg('Error sending invoice: ' + JSON.stringify(data))
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Invoices</h1>
      {actionMsg && <div style={{ marginBottom: 12 }}>{actionMsg}</div>}
      {loading ? (
        <div>Loading...</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ border: '1px solid #ddd', padding: 8 }}>Invoice No</th>
              <th style={{ border: '1px solid #ddd', padding: 8 }}>Customer</th>
              <th style={{ border: '1px solid #ddd', padding: 8 }}>Amount</th>
              <th style={{ border: '1px solid #ddd', padding: 8 }}>Status</th>
              <th style={{ border: '1px solid #ddd', padding: 8 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td style={{ border: '1px solid #ddd', padding: 8 }}>{inv.invoice_no}</td>
                <td style={{ border: '1px solid #ddd', padding: 8 }}>{inv.customer_name || inv.contact_phone}</td>
                <td style={{ border: '1px solid #ddd', padding: 8 }}>₹ {Number(inv.amount).toFixed(2)}</td>
                <td style={{ border: '1px solid #ddd', padding: 8 }}>{inv.status}</td>
                <td style={{ border: '1px solid #ddd', padding: 8 }}>
                  {inv.file_path ? (
                    <button onClick={() => viewPdf(inv.file_path)} style={{ marginRight: 8 }}>View PDF</button>
                  ) : (
                    <span style={{ marginRight: 8 }}>No file</span>
                  )}
                  {inv.status === 'draft' && (
                    <button onClick={() => approveAndSend(inv)} style={{ background:'#2b6cb0', color:'#fff', padding:'6px 10px' }}>Approve & Send</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
