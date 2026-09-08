import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { markMessageAsRead } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

/**
 * POST /api/whatsapp/mark-read
 *
 * Body: { conversation_id: <UUID> }
 *
 * Tells Meta the customer's latest message(s) have been read, which
 * flips the double-tick to blue on the customer's side. Called by the
 * inbox UI whenever a conversation with unread messages is opened
 * (see the unread-reset effect in message-thread.tsx) — it runs
 * alongside, not instead of, the local `unread_count` reset, since
 * that only clears our own badge and never talks to Meta.
 *
 * Only the single most-recent inbound message's wamid needs to be
 * sent — Meta applies the read receipt to that message and everything
 * before it in the thread.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');

    const limit = checkRateLimit(`markRead:${userId}`, RATE_LIMITS.markRead);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const body = await request.json();
    const { conversation_id: conversationId } = body as {
      conversation_id?: string;
    };

    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversation_id is required' },
        { status: 400 },
      );
    }

    // Verify the conversation belongs to this account.
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, account_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (convError || !conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 },
      );
    }

    // Latest inbound (customer) message that has a Meta wamid.
    const { data: lastCustomerMessage, error: msgError } = await supabase
      .from('messages')
      .select('id, message_id')
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'customer')
      .not('message_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (msgError) {
      console.error('[whatsapp/mark-read] message lookup failed:', msgError.message);
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
    }

    // Nothing from the customer yet (or none reached Meta) — nothing to
    // mark read. Not an error; the UI can call this unconditionally.
    if (!lastCustomerMessage?.message_id) {
      return NextResponse.json({ success: true, skipped: true });
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', accountId)
      .single();

    if (configError || !config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured.' },
        { status: 400 },
      );
    }

    const accessToken = decrypt(config.access_token);

    try {
      await markMessageAsRead({
        phoneNumberId: config.phone_number_id,
        accessToken,
        messageId: lastCustomerMessage.message_id,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown Meta API error';
      console.error('[whatsapp/mark-read] Meta call failed:', message);
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in WhatsApp mark-read POST:', error);
    return toErrorResponse(error);
  }
}
