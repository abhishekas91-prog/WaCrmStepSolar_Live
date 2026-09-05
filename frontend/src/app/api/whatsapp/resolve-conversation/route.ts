import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import { SendMessageError } from '@/lib/whatsapp/send-message';

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent');
    const body = await request.json().catch(() => ({}));
    const { phone, name, contact_id } = body;

    if (contact_id) {
      const { data: conv, error } = await supabase
        .from('conversations')
        .select('id')
        .eq('contact_id', contact_id)
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if (conv?.id) {
        return NextResponse.json({ conversationId: conv.id });
      }

      // If no conversation found by contact_id, look up contact's phone
      const { data: contact } = await supabase
        .from('contacts')
        .select('phone, name')
        .eq('id', contact_id)
        .maybeSingle();

      if (!contact?.phone) {
        return NextResponse.json({ error: 'Contact phone not found' }, { status: 404 });
      }

      const resolved = await resolveConversationByPhone(
        supabase,
        accountId,
        contact.phone,
        name || contact.name
      );
      return NextResponse.json({ conversationId: resolved.conversationId });
    }

    if (!phone) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
    }

    const resolved = await resolveConversationByPhone(
      supabase,
      accountId,
      phone,
      name
    );

    return NextResponse.json({ conversationId: resolved.conversationId });
  } catch (err) {
    if (err instanceof SendMessageError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return toErrorResponse(err);
  }
}

