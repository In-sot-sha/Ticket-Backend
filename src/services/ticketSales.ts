/** Block new sales when the organizer has paused a ticket type. Existing tickets stay valid. */
export function assertTicketSalesOpen(ticketType: { isPaused?: boolean | null; name?: string | null }) {
  if (!ticketType.isPaused) return;
  const label = ticketType.name?.trim() || 'This ticket';
  throw Object.assign(new Error(`${label} is paused and not on sale right now.`), {
    status: 400,
    code: 'TICKET_PAUSED',
  });
}
