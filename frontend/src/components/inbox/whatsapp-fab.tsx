"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquarePlus,
  Search,
  UserPlus,
  Users,
  Send,
  Loader2,
  X,
  Phone,
  Radio,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Contact } from "@/types";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface WhatsAppFabProps {
  onSelectConversation?: (convId: string) => void;
}

export function WhatsAppFab({ onSelectConversation }: WhatsAppFabProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [resolving, setResolving] = useState(false);

  // Direct number input state
  const [directPhone, setDirectPhone] = useState("");
  const [directName, setDirectName] = useState("");
  const [showDirectForm, setShowDirectForm] = useState(false);

  // Load contacts when modal opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      setLoadingContacts(true);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("contacts")
          .select("id, name, phone, avatar_url, company")
          .order("name", { ascending: true })
          .limit(100);

        if (!error && data && !cancelled) {
          setContacts(data as Contact[]);
        }
      } catch (err) {
        console.error("Failed to load contacts for FAB:", err);
      } finally {
        if (!cancelled) setLoadingContacts(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Handle resolving conversation and navigating
  const startChat = useCallback(
    async (params: { phone?: string; name?: string; contact_id?: string }) => {
      setResolving(true);
      try {
        const res = await fetch("/api/whatsapp/resolve-conversation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        if (data.conversationId) {
          setOpen(false);
          setShowDirectForm(false);
          setDirectPhone("");
          setDirectName("");
          if (onSelectConversation) {
            onSelectConversation(data.conversationId);
          } else {
            router.push(`/inbox?c=${data.conversationId}`);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start chat";
        toast.error(message);
      } finally {
        setResolving(false);
      }
    },
    [router, onSelectConversation]
  );

  const filteredContacts = useMemo(() => {
    if (!search.trim()) return contacts;
    const q = search.toLowerCase();
    return contacts.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.phone?.toLowerCase().includes(q) ||
        c.company?.toLowerCase().includes(q)
    );
  }, [contacts, search]);

  return (
    <>
      {/* Floating Action Button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="New WhatsApp Chat"
        className="fixed bottom-20 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#25D366] text-white shadow-xl transition-all duration-200 hover:bg-[#20bd5a] hover:scale-105 active:scale-95 lg:hidden"
      >
        <MessageSquarePlus className="h-6 w-6" />
      </button>

      {/* WhatsApp-Style "Select Contact" Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] w-full max-w-md p-0 overflow-hidden rounded-2xl border-border bg-card">
          {/* Header */}
          <div className="bg-[#008069] dark:bg-[#1f2c34] p-4 text-white">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-lg font-semibold text-white">
                  Select Contact
                </DialogTitle>
                <p className="text-xs text-white/80">
                  {contacts.length} {contacts.length === 1 ? "contact" : "contacts"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-1 text-white/80 hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Search Input */}
            <div className="relative mt-3">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or phone number..."
                className="w-full rounded-xl bg-background px-9 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none ring-1 ring-border focus:ring-2 focus:ring-[#25D366]"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <ScrollArea className="max-h-[60vh] p-2">
            {/* Quick Action Rows */}
            <div className="divide-y divide-border/40 pb-2">
              {/* Direct WhatsApp message without saving */}
              {!showDirectForm ? (
                <button
                  type="button"
                  onClick={() => setShowDirectForm(true)}
                  className="flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted/60"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white shadow-sm">
                    <Phone className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      Message a phone number directly
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Chat with any WhatsApp number without saving
                    </p>
                  </div>
                </button>
              ) : (
                <div className="rounded-xl border border-border/80 bg-muted/30 p-3 space-y-2.5 my-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Direct WhatsApp Chat
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowDirectForm(false)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="space-y-2">
                    <Input
                      type="tel"
                      placeholder="Phone number (e.g. +919876543210)"
                      value={directPhone}
                      onChange={(e) => setDirectPhone(e.target.value)}
                      className="h-9 text-sm"
                    />
                    <Input
                      type="text"
                      placeholder="Contact name (optional)"
                      value={directName}
                      onChange={(e) => setDirectName(e.target.value)}
                      className="h-9 text-sm"
                    />
                    <Button
                      size="sm"
                      disabled={!directPhone.trim() || resolving}
                      onClick={() =>
                        startChat({
                          phone: directPhone.trim(),
                          name: directName.trim() || undefined,
                        })
                      }
                      className="w-full bg-[#25D366] hover:bg-[#20bd5a] text-white font-medium gap-1.5"
                    >
                      {resolving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Start WhatsApp Chat
                    </Button>
                  </div>
                </div>
              )}

              {/* New Contact shortcut */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push("/contacts?action=new");
                }}
                className="flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted/60"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#008069] dark:bg-[#1f2c34] text-white shadow-sm">
                  <UserPlus className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    New Contact
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Add a new lead or customer
                  </p>
                </div>
              </button>

              {/* New Broadcast shortcut */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push("/broadcasts");
                }}
                className="flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted/60"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#008069]/80 dark:bg-[#1f2c34] text-white shadow-sm">
                  <Radio className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    New Broadcast Campaign
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Send WhatsApp template to audience
                  </p>
                </div>
              </button>
            </div>

            {/* Contacts Section */}
            <div className="mt-2">
              <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Contacts on StepSolar
              </div>

              {loadingContacts ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : filteredContacts.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No contacts found
                </div>
              ) : (
                <div className="space-y-0.5">
                  {filteredContacts.map((c) => {
                    const initials = (c.name || c.phone || "U")
                      .charAt(0)
                      .toUpperCase();
                    return (
                      <button
                        key={c.id}
                        type="button"
                        disabled={resolving}
                        onClick={() => startChat({ contact_id: c.id, phone: c.phone })}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted/50 active:bg-muted/80"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-foreground text-sm">
                          {c.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={c.avatar_url}
                              alt={c.name || c.phone}
                              className="h-10 w-10 rounded-full object-cover"
                            />
                          ) : (
                            initials
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {c.name || c.phone}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {c.phone}
                            {c.company ? ` • ${c.company}` : ""}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}

