```js
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2022-11-15",
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toPositiveInt(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function safeDate(value) {
  if (!value || value === "") return null;
  return value;
}

function getPeriodPrice(property, period) {
  if (period === "morning") return toNumber(property.price_morning);
  if (period === "afternoon") return toNumber(property.price_afternoon);
  if (period === "evening") return toNumber(property.price_evening);
  return 0;
}

function calcAmountCents(property, body) {
  const type = body.reservation_type || "time";

  const pricePerHour = toNumber(property.price_per_hour);
  const pricePerDay = toNumber(property.price_per_day);
  const pricePerMonth = toNumber(property.price_per_month);
  const minMonthsFullRental = Math.max(
    3,
    toPositiveInt(property.min_months_full_rental) || 3
  );

  const durationHours = toPositiveInt(body.duration_hours);
  const daysCount = toPositiveInt(body.days_count) || 1;
  const monthsCount = toPositiveInt(body.months_count);
  const fixedPeriodPrice = getPeriodPrice(property, body.period);

  let amountBRL = 0;

  switch (type) {
    case "time": {
      const hours = durationHours || 1;

      if (pricePerHour > 0) {
        amountBRL = pricePerHour * hours;
      } else if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
        amountBRL = toNumber(body.amount);
      } else {
        throw new Error("Preço por hora não configurado");
      }
      break;
    }

    case "period": {
      const hours = durationHours || 4;

      if (fixedPeriodPrice > 0) {
        amountBRL = fixedPeriodPrice * daysCount;
      } else if (pricePerHour > 0) {
        amountBRL = pricePerHour * hours * daysCount;
      } else if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
        amountBRL = toNumber(body.amount);
      } else {
        throw new Error("Preço do período não configurado");
      }
      break;
    }

    case "day": {
      const days = daysCount || 1;

      if (pricePerDay > 0) {
        amountBRL = pricePerDay * days;
      } else if (pricePerHour > 0) {
        amountBRL = pricePerHour * 8 * days;
      } else if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
        amountBRL = toNumber(body.amount);
      } else {
        throw new Error("Preço por diária não configurado");
      }
      break;
    }

    case "full_property": {
      if (!monthsCount) {
        throw new Error("months_count é obrigatório para reservation_type=full_property");
      }

      if (monthsCount < minMonthsFullRental) {
        throw new Error(
          `Imóvel completo exige no mínimo ${minMonthsFullRental} meses`
        );
      }

      if (pricePerMonth > 0) {
        amountBRL = pricePerMonth * monthsCount;
      } else if (pricePerDay > 0) {
        amountBRL = pricePerDay * 30 * monthsCount;
      } else if (pricePerHour > 0) {
        amountBRL = pricePerHour * 8 * 30 * monthsCount;
      } else if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
        amountBRL = toNumber(body.amount);
      } else {
        throw new Error("Preço mensal não configurado");
      }
      break;
    }

    default: {
      if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
        amountBRL = toNumber(body.amount);
      } else {
        throw new Error("Tipo de reserva inválido");
      }
    }
  }

  const amountCents = Math.round(amountBRL * 100);

  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("Valor calculado inválido");
  }

  return amountCents;
}

// Cobra mensalmente na assinatura, mas calcula a mensalidade com base na ocorrência semanal
function calcRecurringMonthlyAmountCents(property, body) {
  const type = body.reservation_type || "time";

  const pricePerHour = toNumber(property.price_per_hour);
  const pricePerDay = toNumber(property.price_per_day);
  const pricePerMonth = toNumber(property.price_per_month);
  const fixedPeriodPrice = getPeriodPrice(property, body.period);

  let weeklyOccurrenceBRL = 0;

  switch (type) {
    case "full_property": {
      if (pricePerMonth > 0) {
        weeklyOccurrenceBRL = pricePerMonth;
      } else if (pricePerDay > 0) {
        weeklyOccurrenceBRL = pricePerDay * 30;
      } else if (pricePerHour > 0) {
        weeklyOccurrenceBRL = pricePerHour * 8 * 30;
      } else {
        throw new Error("Preço mensal não configurado");
      }
      break;
    }

    case "period": {
      const daysCount = toPositiveInt(body.days_count) || 1;
      const hours = toPositiveInt(body.duration_hours) || 4;

      if (fixedPeriodPrice > 0) {
        weeklyOccurrenceBRL = fixedPeriodPrice * daysCount;
      } else if (pricePerHour > 0) {
        weeklyOccurrenceBRL = pricePerHour * hours * daysCount;
      } else {
        throw new Error("Preço do período não configurado");
      }
      break;
    }

    case "day": {
      const days = toPositiveInt(body.days_count) || 1;

      if (pricePerDay > 0) {
        weeklyOccurrenceBRL = pricePerDay * days;
      } else if (pricePerHour > 0) {
        weeklyOccurrenceBRL = pricePerHour * 8 * days;
      } else {
        throw new Error("Preço por diária não configurado");
      }
      break;
    }

    case "time":
    default: {
      const hours = toPositiveInt(body.duration_hours) || 1;

      if (pricePerHour > 0) {
        weeklyOccurrenceBRL = pricePerHour * hours;
      } else if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
        weeklyOccurrenceBRL = toNumber(body.amount);
      } else {
        throw new Error("Preço por hora não configurado");
      }
      break;
    }
  }

  // mensalidade = valor semanal * 4
  const monthlyAmountCents = Math.round(weeklyOccurrenceBRL * 100 * 4);

  if (!Number.isFinite(monthlyAmountCents) || monthlyAmountCents <= 0) {
    throw new Error("Valor recorrente inválido");
  }

  return monthlyAmountCents;
}

function parseAnyDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseUtcDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);

  if (d.getUTCDate() < day) {
    d.setUTCDate(0);
  }

  return d;
}

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function normalizeWeekdays(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).toLowerCase().trim());
  if (typeof value === "string") {
    return value
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

function weekdayIndexFromString(value) {
  const map = {
    sunday: 0,
    sun: 0,
    0: 0,
    monday: 1,
    mon: 1,
    1: 1,
    tuesday: 2,
    tue: 2,
    2: 2,
    wednesday: 3,
    wed: 3,
    3: 3,
    thursday: 4,
    thu: 4,
    4: 4,
    friday: 5,
    fri: 5,
    5: 5,
    saturday: 6,
    sat: 6,
    6: 6,
  };
  const key = String(value).toLowerCase().trim();
  return map[key];
}

function getFixedPeriodWindow(period) {
  const windows = {
    morning: { start: "08:00", end: "12:00" },
    afternoon: { start: "13:00", end: "17:00" },
    evening: { start: "18:00", end: "22:00" },
  };
  return windows[period] || windows.morning;
}

function getIntervalFromSimplePayload(body) {
  const type = body.reservation_type || "time";

  if (body.start_at && body.end_at) {
    const start = parseAnyDate(body.start_at);
    const end = parseAnyDate(body.end_at);
    if (start && end && start < end) return { start, end };
  }

  if (!body.date) return null;

  if (type === "day") {
    const start = parseUtcDate(body.date);
    if (!start) return null;
    return { start, end: addDays(start, 1) };
  }

  if (type === "full_property") {
    const start = body.start_at ? parseAnyDate(body.start_at) : parseUtcDate(body.date);
    if (!start) return null;
    const months = toPositiveInt(body.recurrence_months || body.months_count) || 3;
    return { start, end: addMonths(start, months) };
  }

  if (type === "period") {
    const window = getFixedPeriodWindow(body.period || "morning");
    const start = parseAnyDate(`${body.date}T${window.start}:00`);
    const end = parseAnyDate(`${body.date}T${window.end}:00`);
    if (start && end) return { start, end };
  }

  if (type === "time") {
    if (body.start_at && body.end_at) {
      const start = parseAnyDate(body.start_at);
      const end = parseAnyDate(body.end_at);
      if (start && end) return { start, end };
    }
  }

  return null;
}

function buildRequestedIntervals(body) {
  const type = body.reservation_type || "time";
  const billingMode = body.billing_mode || "one_time";
  const items = Array.isArray(body.reservation_items) ? body.reservation_items : [];

  const baseIntervals = [];

  if (items.length > 0) {
    for (const item of items) {
      let start = null;
      let end = null;

      if (item.start_at && item.end_at) {
        start = parseAnyDate(item.start_at);
        end = parseAnyDate(item.end_at);
      } else if (item.date) {
        if (type === "day") {
          const base = parseUtcDate(item.date);
          if (base) {
            start = base;
            end = addDays(base, 1);
          }
        } else if (type === "period") {
          const window = getFixedPeriodWindow(item.period || body.period || "morning");
          start = parseAnyDate(`${item.date}T${window.start}:00`);
          end = parseAnyDate(`${item.date}T${window.end}:00`);
        } else if (type === "time") {
          if (item.startTime && item.endTime) {
            start = parseAnyDate(`${item.date}T${item.startTime}:00`);
            end = parseAnyDate(`${item.date}T${item.endTime}:00`);
          }
        }
      }

      if (start && end && start < end) {
        baseIntervals.push({ start, end });
      }
    }
  }

  if (baseIntervals.length === 0) {
    const single = getIntervalFromSimplePayload(body);
    if (single) baseIntervals.push(single);
  }

  if (billingMode !== "recurring") {
    return baseIntervals;
  }

  const recurrenceUnit = String(
    body.recurrence_unit || body.recurrence_frequency || body.repeat_unit || "weekly"
  ).toLowerCase();

  const recurrenceInterval = Math.max(
    1,
    toPositiveInt(body.recurrence_interval) || 1
  );

  const recurrenceCount =
    toPositiveInt(body.recurrence_count) ||
    toPositiveInt(body.count) ||
    toPositiveInt(body.recurring_count) ||
    toPositiveInt(body.recurrence_months);

  const recurrenceUntil =
    body.recurrence_until || body.until || body.end_date || null;

  const weekdays = normalizeWeekdays(
    body.weekdays || body.days_of_week || body.byday
  );

  if (type === "full_property") {
    const interval = baseIntervals[0] || getIntervalFromSimplePayload(body);
    if (!interval) return [];

    const months = recurrenceCount || toPositiveInt(body.months_count) || 1;
    return [
      {
        start: interval.start,
        end: addMonths(interval.start, months),
      },
    ];
  }

  const expanded = [];

  for (const base of baseIntervals) {
    expanded.push(base);

    const durationMs = base.end.getTime() - base.start.getTime();
    if (durationMs <= 0) continue;

    let occurrencesCreated = 1;
    let cursor = new Date(base.start.getTime());

    while (true) {
      if (recurrenceCount && occurrencesCreated >= recurrenceCount) break;

      if (recurrenceUnit === "daily") {
        cursor = addDays(cursor, recurrenceInterval);
      } else if (recurrenceUnit === "monthly") {
        cursor = addMonths(cursor, recurrenceInterval);
      } else {
        cursor = addDays(cursor, recurrenceInterval * 7);
      }

      if (recurrenceUntil) {
        const untilDate = parseAnyDate(recurrenceUntil);
        if (untilDate && cursor > untilDate) break;
      }

      if (weekdays.length > 0 && recurrenceUnit === "weekly") {
        const wd = cursor.getUTCDay();
        const allowed = weekdays.some((day) => weekdayIndexFromString(day) === wd);
        if (!allowed) {
          continue;
        }
      }

      const nextStart = new Date(cursor.getTime());
      const nextEnd = new Date(cursor.getTime() + durationMs);

      expanded.push({ start: nextStart, end: nextEnd });
      occurrencesCreated += 1;

      if (occurrencesCreated > 500) break;
    }
  }

  return expanded;
}

async function fetchProperty(propertyId) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    throw new Error("Variáveis SUPABASE_URL ou SUPABASE_SERVICE_ROLE ausentes");
  }

  const selectFields =
    "id,title,price_per_hour,price_per_day,price_per_month,price_morning,price_afternoon,price_evening,min_months_full_rental";

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/properties?id=eq.${propertyId}&select=${encodeURIComponent(selectFields)}`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      },
    }
  );

  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`Erro ao buscar imóvel: ${raw}`);
  }

  const data = raw ? JSON.parse(raw) : [];
  const property = data?.[0];

  if (!property) {
    throw new Error("Imóvel não encontrado");
  }

  return property;
}

async function fetchBookings(propertyId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/bookings?property_id=eq.${propertyId}&status=neq.cancelled&select=id,start_at,end_at,date,reservation_type,period,duration_hours,days_count,months_count,billing_mode`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      },
    }
  );

  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`Erro ao consultar reservas: ${raw}`);
  }

  return raw ? JSON.parse(raw) : [];
}

async function fetchRecurringContracts(propertyId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/recurring_contracts?property_id=eq.${propertyId}&status=neq.cancelled&select=*`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      },
    }
  );

  const raw = await res.text();

  if (!res.ok) {
    return [];
  }

  return raw ? JSON.parse(raw) : [];
}

function buildIntervalsFromContract(contract) {
  const intervals = [];

  if (contract.start_at && contract.end_at) {
    const start = parseAnyDate(contract.start_at);
    const end = parseAnyDate(contract.end_at);
    if (start && end && start < end) intervals.push({ start, end });
  } else if (contract.date && contract.startTime && contract.endTime) {
    const start = parseAnyDate(`${contract.date}T${contract.startTime}:00`);
    const end = parseAnyDate(`${contract.date}T${contract.endTime}:00`);
    if (start && end && start < end) intervals.push({ start, end });
  } else if (contract.date) {
    const period = contract.period || "morning";
    const window = getFixedPeriodWindow(period);
    const start = parseAnyDate(`${contract.date}T${window.start}:00`);
    const end = parseAnyDate(`${contract.date}T${window.end}:00`);
    if (start && end && start < end) intervals.push({ start, end });
  }

  const base = intervals[0];
  if (!base) return intervals;

  const recurrenceUnit = String(
    contract.recurrence_unit || contract.recurrence_frequency || contract.repeat_unit || "weekly"
  ).toLowerCase();

  const recurrenceInterval = Math.max(
    1,
    toPositiveInt(contract.recurrence_interval) || 1
  );

  const recurrenceCount =
    toPositiveInt(contract.recurrence_months) ||
    toPositiveInt(contract.recurrence_count) ||
    toPositiveInt(contract.count) ||
    toPositiveInt(contract.recurring_count);

  const recurrenceUntil =
    contract.recurrence_until || contract.until || contract.end_date || null;

  const weekdays = normalizeWeekdays(
    contract.weekdays || contract.days_of_week || contract.byday
  );

  const durationMs = base.end.getTime() - base.start.getTime();
  if (durationMs <= 0) return intervals;

  let occurrencesCreated = 1;
  let cursor = new Date(base.start.getTime());

  while (true) {
    if (recurrenceCount && occurrencesCreated >= recurrenceCount) break;

    if (recurrenceUnit === "daily") {
      cursor = addDays(cursor, recurrenceInterval);
    } else if (recurrenceUnit === "monthly") {
      cursor = addMonths(cursor, recurrenceInterval);
    } else {
      cursor = addDays(cursor, recurrenceInterval * 7);
    }

    if (recurrenceUntil) {
      const untilDate = parseAnyDate(recurrenceUntil);
      if (untilDate && cursor > untilDate) break;
    }

    if (weekdays.length > 0 && recurrenceUnit === "weekly") {
      const wd = cursor.getUTCDay();
      const allowed = weekdays.some((day) => weekdayIndexFromString(day) === wd);
      if (!allowed) {
        continue;
      }
    }

    const nextStart = new Date(cursor.getTime());
    const nextEnd = new Date(cursor.getTime() + durationMs);

    intervals.push({ start: nextStart, end: nextEnd });
    occurrencesCreated += 1;

    if (occurrencesCreated > 500) break;
  }

  return intervals;
}

function hasAnyOverlap(requestedIntervals, existingIntervals) {
  for (const req of requestedIntervals) {
    for (const ex of existingIntervals) {
      if (intervalsOverlap(req.start, req.end, ex.start, ex.end)) {
        return true;
      }
    }
  }
  return false;
}

async function hasConflict(propertyId, requestedIntervals) {
  if (requestedIntervals.length === 0) return false;

  const existingBookings = await fetchBookings(propertyId);

  const bookingIntervals = [];
  for (const booking of existingBookings) {
    if (booking.start_at && booking.end_at) {
      const start = parseAnyDate(booking.start_at);
      const end = parseAnyDate(booking.end_at);
      if (start && end && start < end) {
        bookingIntervals.push({ start, end });
        continue;
      }
    }

    if (booking.date) {
      const base = parseUtcDate(booking.date);
      if (base) {
        bookingIntervals.push({
          start: base,
          end: addDays(base, 1),
        });
      }
    }
  }

  if (hasAnyOverlap(requestedIntervals, bookingIntervals)) {
    return true;
  }

  const recurringContracts = await fetchRecurringContracts(propertyId);
  const recurringIntervals = [];

  for (const contract of recurringContracts) {
    recurringIntervals.push(...buildIntervalsFromContract(contract));
  }

  if (hasAnyOverlap(requestedIntervals, recurringIntervals)) {
    return true;
  }

  return false;
}

async function createBooking(body, amount) {
  const payload = {
    property_id: body.property_id || null,
    guest_name: body.guest_name || "Cliente",
    guest_email: body.guest_email || null,
    phone: body.phone || null,
    date: safeDate(body.date),
    start_at: safeDate(body.start_at),
    end_at: safeDate(body.end_at),
    reservation_type: body.reservation_type || "time",
    period: body.period || null,
    duration_hours: body.duration_hours ? Number(body.duration_hours) : null,
    days_count: body.days_count ? Number(body.days_count) : null,
    months_count:
      body.months_count ? Number(body.months_count) :
      body.recurrence_months ? Number(body.recurrence_months) :
      null,
    billing_mode: body.billing_mode || "one_time",
    total_amount: amount,
    price_cents: Math.round(amount * 100),
    currency: "brl",
    status: "pending",
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  const raw = await res.text();
  let data;

  try {
    data = raw ? JSON.parse(raw) : [];
  } catch {
    throw new Error(`Erro ao criar booking: ${raw}`);
  }

  if (!res.ok) {
    throw new Error(data?.message || data?.error || raw || "Erro ao criar booking");
  }

  const booking = Array.isArray(data) ? data[0] : data;

  if (!booking?.id) {
    throw new Error("Booking criado sem ID");
  }

  return booking;
}

async function updateBookingStripeSession(bookingId, sessionId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      stripe_session_id: sessionId,
    }),
  });

  if (!res.ok) {
    const raw = await res.text();
    throw new Error(`Erro ao salvar stripe_session_id no booking: ${raw}`);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({
        error: "Variáveis de ambiente ausentes",
      });
    }

    const body = req.body || {};

    if (!body.property_id) {
      return res.status(400).json({
        error: "property_id é obrigatório",
      });
    }

    const property = await fetchProperty(body.property_id);

    const requestedIntervals = buildRequestedIntervals(body);
    const conflict = await hasConflict(body.property_id, requestedIntervals);

    if (conflict) {
      return res.status(409).json({
        error: "Este horário já está reservado",
      });
    }

    const isRecurring = body.billing_mode === "recurring";
    const amountCents = isRecurring
      ? calcRecurringMonthlyAmountCents(property, body)
      : calcAmountCents(property, body);

    const amountBRL = amountCents / 100;

    const booking = await createBooking(body, amountBRL);

    const commonMetadata = {
      booking_id: String(booking.id),
      property_id: String(body.property_id || ""),
      guest_name: String(body.guest_name || "Cliente"),
      guest_email: String(body.guest_email || ""),
      phone: String(body.phone || ""),
      date: String(body.date || ""),
      start_at: String(body.start_at || ""),
      end_at: String(body.end_at || ""),
      reservation_type: String(body.reservation_type || "time"),
      period: String(body.period || ""),
      duration_hours: String(body.duration_hours || ""),
      days_count: String(body.days_count || ""),
      months_count: String(body.months_count || ""),
      billing_mode: String(body.billing_mode || "one_time"),
      recurrence_months: String(body.recurrence_months || ""),
      recurrence_unit: String(body.recurrence_unit || ""),
      recurrence_count: String(body.recurrence_count || ""),
    };

    const session = await stripe.checkout.sessions.create(
      isRecurring
        ? {
            mode: "subscription",
            payment_method_types: ["card"],
            customer_email: body.guest_email || undefined,
            line_items: [
              {
                price_data: {
                  currency: "brl",
                  product_data: {
                    name: property.title ? `Reserva mensal - ${property.title}` : "Reserva mensal",
                  },
                  unit_amount: amountCents,
                  recurring: {
                    interval: "month",
                  },
                },
                quantity: 1,
              },
            ],
            subscription_data: {
              metadata: commonMetadata,
            },
            metadata: commonMetadata,
            success_url: "https://liberoom.com.br/pagamento-sucesso",
            cancel_url: "https://liberoom.com.br/pagamento-cancelado",
          }
        : {
            mode: "payment",
            payment_method_types: ["card"],
            customer_email: body.guest_email || undefined,
            line_items: [
              {
                price_data: {
                  currency: "brl",
                  product_data: {
                    name: property.title || "Reserva",
                  },
                  unit_amount: amountCents,
                },
                quantity: 1,
              },
            ],
            metadata: commonMetadata,
            success_url: "https://liberoom.com.br/pagamento-sucesso",
            cancel_url: "https://liberoom.com.br/pagamento-cancelado",
          }
    );

    await updateBookingStripeSession(booking.id, session.id);

    return res.status(200).json({
      url: session.url,
      session_id: session.id,
      amount_cents: amountCents,
      booking_id: booking.id,
    });
  } catch (err) {
    console.error("Stripe error:", err);
    return res.status(500).json({
      error: err.message || "Erro interno",
    });
  }
}
```
