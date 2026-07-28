import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

function formatPropertyTitle(title: string | null | undefined, isPrimary: boolean): string {
  const trimmed = title?.trim();
  if (trimmed) return trimmed;
  return isPrimary ? "Primary property" : "Address";
}

function formatBookingStreet(street: string | null | undefined, apt: string | null | undefined): string | null {
  const line = [street, apt].filter(Boolean).join(" ").trim();
  return line || street || null;
}

type WalkthroughRow = {
  id: string;
  walkthrough_type: string;
  client_id: string | null;
  lead_id: string | null;
  property_id?: string | null;
  booking_id?: string | null;
  service_street?: string | null;
  service_apt?: string | null;
  service_city?: string | null;
  service_state?: string | null;
  service_zip?: string | null;
  property_title?: string | null;
};

export type WalkthroughEmailContactInfo = {
  full_name: string;
  lead_name: string;
  company?: string | null;
  phone: string | null;
  email: string | null;
  service_street: string | null;
  service_apt: string | null;
  service_city: string | null;
  service_state: string | null;
  service_zip: string | null;
  street: string | null;
  apt_suite: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  property_title?: string | null;
};

function withStreetAliases(info: WalkthroughEmailContactInfo): WalkthroughEmailContactInfo {
  return {
    ...info,
    street: info.service_street,
    apt_suite: info.service_apt,
    city: info.service_city,
    state: info.service_state,
    zip_code: info.service_zip,
  };
}

function applyServiceAddress(
  info: WalkthroughEmailContactInfo,
  address: {
    street: string | null | undefined;
    apt?: string | null | undefined;
    city: string | null | undefined;
    state: string | null | undefined;
    zip: string | null | undefined;
  },
  propertyTitle?: string | null,
): WalkthroughEmailContactInfo {
  const serviceStreet = formatBookingStreet(address.street, address.apt) ?? info.service_street;
  const serviceApt = address.apt?.trim() ? address.apt : info.service_apt;
  return withStreetAliases({
    ...info,
    service_street: serviceStreet,
    service_apt: serviceApt ?? null,
    service_city: address.city ?? info.service_city,
    service_state: address.state ?? info.service_state,
    service_zip: address.zip ?? info.service_zip,
    property_title: propertyTitle ?? info.property_title,
  });
}

async function resolveLinkedBookingId(
  supabase: SupabaseClient,
  walkthrough: Pick<WalkthroughRow, "id" | "booking_id">,
): Promise<string | null> {
  if (walkthrough.booking_id) return walkthrough.booking_id;

  const { data: booking } = await supabase
    .from("bookings")
    .select("id")
    .eq("converted_to_type", "walkthrough")
    .eq("converted_to_id", walkthrough.id)
    .maybeSingle();

  return booking?.id ?? null;
}

async function loadBookingAddress(supabase: SupabaseClient, bookingId: string) {
  const { data: booking } = await supabase
    .from("bookings")
    .select("street, apt_suite, city, state, zip_code, client_property_id")
    .eq("id", bookingId)
    .maybeSingle();

  return booking;
}

async function loadClientPropertyAddress(supabase: SupabaseClient, propertyId: string) {
  const { data } = await supabase
    .from("client_properties")
    .select("street, apt_suite, city, state, zip_code, title, is_primary")
    .eq("id", propertyId)
    .maybeSingle();

  return data ?? null;
}

async function resolvePropertyMeta(
  supabase: SupabaseClient,
  clientPropertyId: string | null | undefined,
  persistedTitle?: string | null,
): Promise<{ title: string | null }> {
  if (persistedTitle) return { title: persistedTitle };
  if (!clientPropertyId) return { title: null };

  const { data: property } = await supabase
    .from("client_properties")
    .select("title, is_primary")
    .eq("id", clientPropertyId)
    .maybeSingle();

  if (!property) return { title: null };
  return { title: formatPropertyTitle(property.title, property.is_primary) };
}

/**
 * Resolves contact + service address for walkthrough emails/SMS.
 * Prefers property_id, then persisted walkthrough.service_*, then linked booking.
 */
export async function resolveWalkthroughContactInfo(
  supabase: SupabaseClient,
  walkthrough: WalkthroughRow,
): Promise<WalkthroughEmailContactInfo | null> {
  let info: WalkthroughEmailContactInfo | null = null;

  if (walkthrough.walkthrough_type === "client" && walkthrough.client_id) {
    const { data: client } = await supabase
      .from("clients")
      .select("full_name, company, phone, email, service_street, service_apt, service_city, service_state, service_zip")
      .eq("id", walkthrough.client_id)
      .maybeSingle();

    if (client) {
      info = withStreetAliases({
        full_name: client.full_name,
        lead_name: client.full_name,
        company: client.company,
        phone: client.phone,
        email: client.email,
        service_street: client.service_street,
        service_apt: client.service_apt ?? null,
        service_city: client.service_city,
        service_state: client.service_state,
        service_zip: client.service_zip,
        street: null,
        apt_suite: null,
        city: null,
        state: null,
        zip_code: null,
      });
    }
  } else if (walkthrough.walkthrough_type === "lead" && walkthrough.lead_id) {
    const { data: lead } = await supabase
      .from("leads")
      .select("full_name, company_name, phone, email, address, apt_suite, city, state, zip_code")
      .eq("id", walkthrough.lead_id)
      .maybeSingle();

    if (lead) {
      info = withStreetAliases({
        full_name: lead.full_name,
        lead_name: lead.full_name,
        company: lead.company_name,
        phone: lead.phone,
        email: lead.email,
        service_street: lead.address,
        service_apt: lead.apt_suite ?? null,
        service_city: lead.city,
        service_state: lead.state,
        service_zip: lead.zip_code,
        street: null,
        apt_suite: null,
        city: null,
        state: null,
        zip_code: null,
      });
    } else {
      const { data: booking } = await supabase
        .from("bookings")
        .select("lead_name, phone, email, street, apt_suite, city, state, zip_code")
        .eq("id", walkthrough.lead_id)
        .maybeSingle();

      if (booking) {
        info = withStreetAliases({
          full_name: booking.lead_name,
          lead_name: booking.lead_name,
          company: null,
          phone: booking.phone,
          email: booking.email,
          service_street: formatBookingStreet(booking.street, booking.apt_suite),
          service_apt: booking.apt_suite ?? null,
          service_city: booking.city,
          service_state: booking.state,
          service_zip: booking.zip_code,
          street: null,
          apt_suite: null,
          city: null,
          state: null,
          zip_code: null,
        });
      }
    }
  }

  if (!info) return null;

  if (walkthrough.property_id) {
    const property = await loadClientPropertyAddress(supabase, walkthrough.property_id);
    if (property) {
      return applyServiceAddress(
        info,
        {
          street: property.street,
          apt: property.apt_suite,
          city: property.city,
          state: property.state,
          zip: property.zip_code,
        },
        formatPropertyTitle(property.title, property.is_primary),
      );
    }
  }

  if (walkthrough.service_street) {
    return applyServiceAddress(
      info,
      {
        street: walkthrough.service_street,
        apt: walkthrough.service_apt,
        city: walkthrough.service_city,
        state: walkthrough.service_state,
        zip: walkthrough.service_zip,
      },
      walkthrough.property_title,
    );
  }

  const bookingId = await resolveLinkedBookingId(supabase, walkthrough);
  if (!bookingId) return info;

  const booking = await loadBookingAddress(supabase, bookingId);
  if (!booking) return info;

  const propertyMeta = await resolvePropertyMeta(supabase, booking.client_property_id);
  return applyServiceAddress(
    info,
    {
      street: booking.street,
      apt: booking.apt_suite,
      city: booking.city,
      state: booking.state,
      zip: booking.zip_code,
    },
    propertyMeta.title,
  );
}
