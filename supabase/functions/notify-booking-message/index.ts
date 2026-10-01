import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail, emailLayout, escapeHtml } from "../_shared/email.ts";
import { insertNotification } from "../_shared/notify.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function firePush(userId: string, title: string, body: string, url = "/") {
  fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({ userId, title, body, url }),
  }).catch((e) => console.warn("[push]", e));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!(await checkRateLimit(req, 20, 60_000))) return rateLimitResponse(corsHeaders);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const { data: userData } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { bookingId, messageText, senderName, senderRole, event } =
      await req.json();

    if (messageText && messageText.length > 2000) {
      return new Response(JSON.stringify({ error: "Message too long" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- CHAT MESSAGE (renter ↔ host) ---
    if (event === "chat_message" || !event) {
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, renter, renter_name, renter_email, listing_id")
        .eq("id", bookingId)
        .single();

      if (!booking) {
        return new Response(JSON.stringify({ error: "Booking not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: listing } = await supabase
        .from("listings")
        .select("title, owner")
        .eq("id", booking.listing_id)
        .single();

      // senderRole is client-supplied — verify the caller is actually a
      // party to this booking before sending email/push "on their behalf".
      const callerId = userData.user.id;
      const callerIsRenter = booking.renter === callerId;
      const callerIsHost = listing?.owner === callerId;
      if (!callerIsRenter && !callerIsHost) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const preview = escapeHtml((messageText ?? "").slice(0, 200));
      const safeSenderName = escapeHtml(senderName || "Bruker");
      const appUrl = `https://leieplattform.no/booking/${bookingId}`;

      if (callerIsRenter) {
        // Renter sent → notify host
        const { data: hostUser } = await supabase.auth.admin.getUserById(
          listing?.owner ?? "",
        );
        const hostEmail = hostUser?.user?.email;
        if (hostEmail) {
          await sendEmail(
            hostEmail,
            `Ny melding fra ${safeSenderName} — ${listing?.title ?? "booking"}`,
            emailLayout(
              "Du har fått en melding 📬",
              `<p><strong>${safeSenderName}</strong> har sendt deg en melding angående <strong>${listing?.title ?? "annonsen din"}</strong>:</p>
              <div class="info-box">
                <p style="font-style:italic">"${preview}"</p>
              </div>
              <p>Logg inn og gå til <strong>Innboks</strong> for å svare.</p>
              <a href="${appUrl}" class="btn">Svar på melding →</a>`,
            ),
          );
        }
        if (listing?.owner) {
          const t = `Ny melding fra ${safeSenderName}`;
          const b = `"${preview.slice(0, 80)}"`;
          await insertNotification(supabase, listing.owner, "chat_message", t, b,
            { bookingId, listingTitle: listing.title });
          firePush(listing.owner, t, b, "/booking/" + bookingId);
        }
      } else {
        // Host sent → notify renter
        const renterEmail = booking.renter_email;
        if (renterEmail) {
          await sendEmail(
            renterEmail,
            `Ny melding fra utleier — ${listing?.title ?? "booking"}`,
            emailLayout(
              "Du har fått et svar 📬",
              `<p>Utleier har svart på din booking-forespørsel for <strong>${listing?.title ?? "annonsen"}</strong>:</p>
              <div class="info-box">
                <p style="font-style:italic">"${preview}"</p>
              </div>
              <p>Logg inn for å lese hele samtalen og svare.</p>
              <a href="${appUrl}" class="btn">Gå til samtale →</a>`,
            ),
          );
        }
        if (booking.renter) {
          const t = `Ny melding fra utleier`;
          const b = `${listing?.title ?? "booking"}: "${preview.slice(0, 80)}"`;
          await insertNotification(supabase, booking.renter, "chat_message", t, b,
            { bookingId, listingTitle: listing?.title });
          firePush(booking.renter, t, b, "/booking/" + bookingId);
        }
      }
    }

    // --- BOOKING REQUEST (leietaker søker) → varsle utleier ---
    if (event === "booking_request") {
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, renter, renter_name, renter_email, from_date, to_date, listing_id")
        .eq("id", bookingId)
        .single();

      const { data: listing } = await supabase
        .from("listings")
        .select("title, owner")
        .eq("id", booking?.listing_id ?? "")
        .single();

      // Unlike chat_message/handover_confirmed/return_confirmed below,
      // this branch had no check at all that the caller is the renter
      // on this booking -- any authenticated user could pass an
      // arbitrary bookingId and make the host get a real "new request"
      // email/push for a request that was never actually made.
      if (!booking || booking.renter !== userData.user.id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: hostUser } = await supabase.auth.admin.getUserById(
        listing?.owner ?? "",
      );
      const hostEmail = hostUser?.user?.email;
      const from = booking?.from_date ?? "";
      const to = booking?.to_date ?? "";

      if (hostEmail && booking) {
        await sendEmail(
          hostEmail,
          `Ny leieforespørsel — ${listing?.title ?? "annonsen din"}`,
          emailLayout(
            "Du har fått en leieforespørsel 🎉",
            `<p><strong>${booking.renter_name}</strong> ønsker å leie <strong>${listing?.title ?? "annonsen din"}</strong>.</p>
            <div class="info-box">
              <p><strong>Periode:</strong> ${from} → ${to}</p>
              <p><strong>Leietaker:</strong> ${booking.renter_name}</p>
            </div>
            <p>Logg inn og gå til <strong>Utleier-dashbord</strong> for å godkjenne eller avvise forespørselen.</p>
            <a href="https://leieplattform.no/booking/${bookingId}" class="btn">Se forespørsel →</a>`,
          ),
        );
      }
      if (listing?.owner) {
        const t = `Ny leieforespørsel`;
        const b = `${booking?.renter_name} ønsker å leie ${listing?.title ?? "annonsen din"} (${from} → ${to})`;
        await insertNotification(supabase, listing.owner, "booking_request", t, b,
          { bookingId, listingTitle: listing.title });
        firePush(listing.owner, t, b, "/booking/" + bookingId);
      }
    }

    // --- BOOKING ACCEPTED → varsle leietaker ---
    if (event === "booking_accepted") {
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, renter, renter_name, renter_email, from_date, to_date, listing_id")
        .eq("id", bookingId)
        .single();

      const { data: listing } = await supabase
        .from("listings")
        .select("title, price_per_day, owner")
        .eq("id", booking?.listing_id ?? "")
        .single();

      // Same gap as booking_request above -- only the host who actually
      // owns this listing may trigger an "accepted" notification for it.
      if (!booking || listing?.owner !== userData.user.id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (booking?.renter_email) {
        await sendEmail(
          booking.renter_email,
          `Bestillingen er godkjent — ${listing?.title ?? ""}`,
          emailLayout(
            "Forespørselen din er godkjent ✅",
            `<p>Godt nytt, ${booking.renter_name}! Utleier har godkjent din leieforespørsel.</p>
            <div class="info-box">
              <p><strong>Utstyr:</strong> ${listing?.title ?? ""}</p>
              <p><strong>Periode:</strong> ${booking.from_date} → ${booking.to_date}</p>
            </div>
            <p>Logg inn for å se detaljer, betale og sende meldinger til utleier.</p>
            <a href="https://leieplattform.no/booking/${bookingId}" class="btn">Se booking →</a>`,
          ),
        );
      }
      if (booking?.renter) {
        const t = `Forespørsel godkjent ✅`;
        const b = `${listing?.title ?? "Booking"} er godkjent! (${booking.from_date} → ${booking.to_date})`;
        await insertNotification(supabase, booking.renter, "booking_accepted", t, b,
          { bookingId, listingTitle: listing?.title });
        firePush(booking.renter, t, b, "/booking/" + bookingId);
      }
    }

    // --- BOOKING REJECTED → varsle leietaker ---
    if (event === "booking_rejected") {
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, renter_name, renter_email, listing_id")
        .eq("id", bookingId)
        .single();

      const { data: listing } = await supabase
        .from("listings")
        .select("title, owner")
        .eq("id", booking?.listing_id ?? "")
        .single();

      // Same gap as booking_request/booking_accepted above -- a
      // "declined" notification for a real renter is genuinely harmful
      // noise (they think a real request of theirs was rejected) if
      // anyone but the actual host could trigger it.
      if (!booking || listing?.owner !== userData.user.id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (booking?.renter_email) {
        await sendEmail(
          booking.renter_email,
          `Forespørsel ikke godkjent — ${listing?.title ?? ""}`,
          emailLayout(
            "Forespørselen ble ikke godkjent",
            `<p>Hei ${booking.renter_name}, dessverre ble ikke leieforespørselen din godkjent denne gangen.</p>
            <div class="info-box">
              <p><strong>Utstyr:</strong> ${listing?.title ?? ""}</p>
            </div>
            <p>Du kan søke etter lignende utstyr på Leieplattform.</p>
            <a href="https://leieplattform.no" class="btn">Se andre annonser →</a>`,
          ),
        );
      }
      if (booking?.renter) {
        const t = `Forespørsel avslått`;
        const b = `Din forespørsel for ${listing?.title ?? "annonsen"} ble ikke godkjent. Se etter andre annonser.`;
        await insertNotification(supabase, booking.renter, "booking_rejected", t, b,
          { bookingId, listingTitle: listing?.title });
        firePush(booking.renter, t, b, "/booking/" + bookingId);
      }
    }

    // --- PICKUP CONFIRMED BY ONE PARTY → nudge the other to confirm too ---
    // Purely a "yes, the item changed hands" documentation step since
    // 20260925210000_return_confirmation_step.sql — no money moves on
    // this confirmation anymore, so the copy here must not claim it does
    // (that's now true only of the return_confirmed branch below).
    if (event === "handover_confirmed") {
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, renter, renter_email, listing_id, host_confirmed_handover, renter_confirmed_handover")
        .eq("id", bookingId)
        .single();
      if (!booking) {
        return new Response(JSON.stringify({ error: "Booking not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: listing } = await supabase
        .from("listings")
        .select("title, owner")
        .eq("id", booking.listing_id)
        .single();

      const callerId = userData.user.id;
      const callerIsRenter = booking.renter === callerId;
      const callerIsHost = listing?.owner === callerId;
      if (!callerIsRenter && !callerIsHost) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const bothConfirmed = booking.host_confirmed_handover && booking.renter_confirmed_handover;
      if (!bothConfirmed) {
        const title = listing?.title ?? "utstyret";
        if (callerIsHost) {
          if (booking.renter_email) {
            await sendEmail(
              booking.renter_email,
              `Utleier har bekreftet overlevering — ${title}`,
              emailLayout(
                "Bekreft overlevering du også",
                `<p>Utleier har bekreftet at <strong>${escapeHtml(title)}</strong> er overlevert. Bekreft det samme fra din side.</p>
                <a href="https://leieplattform.no/booking/${bookingId}" class="btn">Bekreft overlevering →</a>`,
              ),
            );
          }
          if (booking.renter) {
            const t = "Bekreft overlevering";
            const b = `Utleier har bekreftet overlevering av ${title} — bekreft fra din side.`;
            await insertNotification(supabase, booking.renter, "handover_confirmed", t, b,
              { bookingId, listingTitle: listing?.title });
            firePush(booking.renter, t, b, "/booking/" + bookingId);
          }
        } else if (listing?.owner) {
          const hostAuth = await supabase.auth.admin.getUserById(listing.owner);
          const hostEmail = hostAuth.data?.user?.email;
          if (hostEmail) {
            await sendEmail(
              hostEmail,
              `Leietaker har bekreftet overlevering — ${title}`,
              emailLayout(
                "Bekreft overlevering du også",
                `<p>Leietaker har bekreftet at <strong>${escapeHtml(title)}</strong> er hentet/levert. Bekreft det samme fra din side.</p>
                <a href="https://leieplattform.no/booking/${bookingId}" class="btn">Bekreft overlevering →</a>`,
              ),
            );
          }
          const t = "Bekreft overlevering";
          const b = `Leietaker har bekreftet overlevering av ${title} — bekreft fra din side.`;
          await insertNotification(supabase, listing.owner, "handover_confirmed", t, b,
            { bookingId, listingTitle: listing?.title });
          firePush(listing.owner, t, b, "/booking/" + bookingId);
        }
      }
    }

    // --- RETURN CONFIRMED BY ONE PARTY → nudge the other to confirm too ---
    // This is the money-relevant confirmation now: without this nudge a
    // booking can sit stuck (deposit/payout unreleased) simply because
    // the other party has no idea they still need to act.
    if (event === "return_confirmed") {
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, renter, renter_email, listing_id, host_confirmed_return, renter_confirmed_return, extra_charges")
        .eq("id", bookingId)
        .single();
      if (!booking) {
        return new Response(JSON.stringify({ error: "Booking not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: listing } = await supabase
        .from("listings")
        .select("title, owner")
        .eq("id", booking.listing_id)
        .single();

      const callerId = userData.user.id;
      const callerIsRenter = booking.renter === callerId;
      const callerIsHost = listing?.owner === callerId;
      if (!callerIsRenter && !callerIsHost) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // openHostReturnModal (src/app.html) explicitly tells the host
      // any damage/cleaning/toll charges entered here are "lagres for
      // admin, som kontakter leietaker/utleier manuelt" -- saved for
      // admin, who contacts you manually. Nothing ever actually told
      // admin: stripe-release-payout only logs the dispute to
      // error_logs once BOTH parties have confirmed return, which
      // could be days after the host's claim if the renter is slow to
      // confirm. Alert admin the moment the claim is actually filed,
      // not whenever the other party eventually gets around to acting.
      const extraCharges = (booking.extra_charges ?? {}) as Record<string, unknown>;
      const hasDamageClaim = callerIsHost &&
        ["damage", "cleaning", "toll"].some((k) => Number(extraCharges[k] ?? 0) > 0);
      if (hasDamageClaim && ADMIN_EMAIL) {
        const title = listing?.title ?? "utstyret";
        const lines = (["damage", "cleaning", "toll"] as const)
          .filter((k) => Number(extraCharges[k] ?? 0) > 0)
          .map((k) => {
            const label = k === "damage" ? "Skader" : k === "cleaning" ? "Ekstra rengjøring" : "Bompenger/transport";
            return `<p><strong>${label}:</strong> ${Number(extraCharges[k])} kr</p>`;
          }).join("");
        await sendEmail(
          ADMIN_EMAIL,
          `Skadekrav registrert — ${title}`,
          emailLayout(
            "Ny tilleggsgebyr-/skaderapport venter på gjennomgang",
            `<p>Utleier har registrert tilleggsgebyrer ved retur av <strong>${escapeHtml(title)}</strong> (booking <code>${escapeHtml(bookingId)}</code>).</p>
            <div class="info-box">${lines}${extraCharges.note ? `<p><strong>Notat:</strong> ${escapeHtml(String(extraCharges.note))}</p>` : ""}</div>
            <p>Depositumet holdes tilbake fra automatisk refusjon til dette er gjennomgått. Bruk admin-panelet for å avgjøre hvor mye som refunderes til leietaker.</p>
            <a href="https://leieplattform.no/app.html#admin" class="btn">Gå til admin-panel →</a>`,
          ),
        ).catch((e) => console.warn("[notify-booking-message] admin damage-claim email failed:", e));
      }

      // Once both have confirmed the booking is complete and
      // stripe-release-payout already emails both parties — no nudge needed.
      const bothConfirmed = booking.host_confirmed_return && booking.renter_confirmed_return;
      if (!bothConfirmed) {
        const title = listing?.title ?? "utstyret";
        if (callerIsHost) {
          if (booking.renter_email) {
            await sendEmail(
              booking.renter_email,
              `Utleier har bekreftet retur — ${title}`,
              emailLayout(
                "Bekreft retur du også",
                `<p>Utleier har bekreftet at <strong>${escapeHtml(title)}</strong> er returnert. Bekreft det samme fra din side for å frigi depositumet.</p>
                <a href="https://leieplattform.no/booking/${bookingId}" class="btn">Bekreft retur →</a>`,
              ),
            );
          }
          if (booking.renter) {
            const t = "Bekreft retur";
            const b = `Utleier har bekreftet retur av ${title} — bekreft fra din side for å få tilbake depositumet.`;
            await insertNotification(supabase, booking.renter, "return_confirmed", t, b,
              { bookingId, listingTitle: listing?.title });
            firePush(booking.renter, t, b, "/booking/" + bookingId);
          }
        } else if (listing?.owner) {
          const hostAuth = await supabase.auth.admin.getUserById(listing.owner);
          const hostEmail = hostAuth.data?.user?.email;
          if (hostEmail) {
            await sendEmail(
              hostEmail,
              `Leietaker har bekreftet retur — ${title}`,
              emailLayout(
                "Bekreft retur du også",
                `<p>Leietaker har bekreftet at <strong>${escapeHtml(title)}</strong> er levert tilbake. Bekreft det samme fra din side for å frigi utbetalingen.</p>
                <a href="https://leieplattform.no/booking/${bookingId}" class="btn">Bekreft retur →</a>`,
              ),
            );
          }
          const t = "Bekreft retur";
          const b = `Leietaker har bekreftet retur av ${title} — bekreft fra din side for å få utbetalt.`;
          await insertNotification(supabase, listing.owner, "return_confirmed", t, b,
            { bookingId, listingTitle: listing?.title });
          firePush(listing.owner, t, b, "/booking/" + bookingId);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[notify-booking-message]", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
