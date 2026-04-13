```tsx
import { useState } from "react";
import { ImageGalleryTrigger } from "@/components/ImageGallery";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Space } from "@/types/space";
import { MapPin, Loader2, Check, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface ReservationModalProps {
  space: Space | null;
  isOpen: boolean;
  onClose: () => void;
}

type ReservationType = "time" | "period" | "day" | "full_property";
type PeriodType = "morning" | "afternoon" | "evening";
type BillingMode = "one_time" | "recurring";

type ReservationItem = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  period: PeriodType;
};

const API_URL = "https://checkout-backend-beta.vercel.app/api/create-checkout-session";

const PERIOD_WINDOWS: Record<PeriodType, { label: string; start: string; end: string }> = {
  morning: { label: "Manhã", start: "08:00", end: "12:00" },
  afternoon: { label: "Tarde", start: "13:00", end: "17:00" },
  evening: { label: "Noite", start: "18:00", end: "22:00" },
};

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyItem(): ReservationItem {
  return {
    id: makeId(),
    date: "",
    startTime: "08:00",
    endTime: "12:00",
    period: "morning",
  };
}

function combineDateTime(date: string, time: string) {
  if (!date || !time) return null;
  return new Date(`${date}T${time}:00`).toISOString();
}

function timeDiffHours(startTime: string, endTime: string) {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);

  if (
    [sh, sm, eh, em].some((n) => Number.isNaN(n)) ||
    sh === undefined ||
    sm === undefined ||
    eh === undefined ||
    em === undefined
  ) {
    return null;
  }

  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;

  const diff = endMinutes - startMinutes;
  if (diff <= 0) return null;

  return diff / 60;
}

export const ReservationModal = ({ space, isOpen, onClose }: ReservationModalProps) => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
  });

  const [reservationType, setReservationType] = useState<ReservationType>("time");
  const [billingMode, setBillingMode] = useState<BillingMode>("one_time");
  const [recurrenceMonths, setRecurrenceMonths] = useState("1");
  const [monthsCount, setMonthsCount] = useState("3");
  const [fullPropertyStartDate, setFullPropertyStartDate] = useState("");

  const [items, setItems] = useState<ReservationItem[]>([createEmptyItem()]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateItem = (id: string, patch: Partial<ReservationItem>) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  };

  const addItem = () => {
    setItems((current) => [...current, createEmptyItem()]);
  };

  const removeItem = (id: string) => {
    setItems((current) => {
      if (current.length === 1) return current;
      return current.filter((item) => item.id !== id);
    });
  };

  const resetForType = (type: ReservationType) => {
    setReservationType(type);
    setItems([createEmptyItem()]);
  };

  const getNumericPropertyId = () => {
    if (!space) return null;

    const rawId =
      (space as any).propertyId ??
      (space as any).property_id ??
      space.id;

    const numericId = Number(rawId);
    return Number.isFinite(numericId) && numericId > 0 ? numericId : null;
  };

  const handleSubmit = async () => {
    if (!space) return;

    if (!formData.name || !formData.email) {
      toast.error("Preencha seus dados");
      return;
    }

    const propertyId = getNumericPropertyId();
    if (!propertyId) {
      toast.error("Não foi possível identificar o imóvel corretamente");
      return;
    }

    if (billingMode === "recurring") {
      const months = Number(recurrenceMonths);
      if (!months || months < 1 || months > 12) {
        toast.error("Escolha uma recorrência entre 1 e 12 meses");
        return;
      }
    }

    if (reservationType === "full_property") {
      if (billingMode === "one_time") {
        const months = Number(monthsCount);
        if (!months || months < 3) {
          toast.error("Imóvel completo exige no mínimo 3 meses");
          return;
        }
      }

      if (!fullPropertyStartDate) {
        toast.error("Selecione a data de início");
        return;
      }
    } else {
      const invalid = items.find((item) => !item.date);
      if (invalid) {
        toast.error("Selecione a data de cada reserva");
        return;
      }
    }

    const firstItem = items[0];

    const payload: Record<string, any> = {
      property_id: propertyId,
      guest_name: formData.name,
      guest_email: formData.email,
      phone: formData.phone || "",
      billing_mode: billingMode,
      reservation_type: reservationType,
      reservation_items: items.map((item) => ({
        date: item.date,
        period: item.period,
        start_at: combineDateTime(item.date, item.startTime),
        end_at: combineDateTime(item.date, item.endTime),
      })),
    };

    if (billingMode === "recurring") {
      payload.recurrence_months = Number(recurrenceMonths);
      payload.recurrence_unit = "weekly";
      payload.recurrence_count = Number(recurrenceMonths) * 4;
    }

    if (reservationType === "time") {
      const hours = timeDiffHours(firstItem.startTime, firstItem.endTime);

      if (!hours || hours <= 0) {
        toast.error("Escolha um horário válido");
        return;
      }

      payload.date = firstItem.date;
      payload.start_at = combineDateTime(firstItem.date, firstItem.startTime);
      payload.end_at = combineDateTime(firstItem.date, firstItem.endTime);
      payload.duration_hours = hours;
    }

    if (reservationType === "period") {
      payload.date = firstItem.date;
      payload.period = firstItem.period;
      payload.start_at = combineDateTime(firstItem.date, firstItem.startTime);
      payload.end_at = combineDateTime(firstItem.date, firstItem.endTime);
      payload.days_count = items.length;
    }

    if (reservationType === "day") {
      payload.date = firstItem.date;
      payload.days_count = items.length;
    }

    if (reservationType === "full_property") {
      payload.date = fullPropertyStartDate;
      payload.start_at = combineDateTime(fullPropertyStartDate, "00:00");

      if (billingMode === "one_time") {
        payload.months_count = Number(monthsCount);
      } else {
        payload.months_count = Number(recurrenceMonths);
      }
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const raw = await response.text();
      let data: any = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = { error: raw };
      }

      if (!response.ok) {
        toast.error(data.error || `Erro no checkout (${response.status})`);
        return;
      }

      if (!data.url) {
        toast.error("A API não devolveu a URL de pagamento");
        return;
      }

      window.location.href = data.url;
    } catch (err) {
      console.error(err);
      toast.error("Erro ao processar pagamento");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!space) return null;

  const canAddMore = reservationType === "period" || reservationType === "day";

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[540px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Reservar Espaço</DialogTitle>
        </DialogHeader>

        <div className="flex gap-4 p-4 bg-muted rounded-xl">
          <div className="relative w-20 h-20 shrink-0">
            <img
              src={space.imageUrl}
              alt={space.title}
              className="w-20 h-20 rounded-lg object-cover"
            />

            {space.images && space.images.length > 1 && (
              <ImageGalleryTrigger
                images={space.images}
                title={space.title}
                mainImage={space.imageUrl}
              />
            )}
          </div>

          <div>
            <h3 className="font-semibold text-foreground">{space.title}</h3>

            <div className="flex items-center gap-1 text-muted-foreground text-sm mt-1">
              <MapPin className="w-3.5 h-3.5" />
              <span>
                {space.neighborhood}, {space.city}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <Label>Nome</Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <Label>Email</Label>
            <Input
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
          </div>

          <div>
            <Label>Telefone</Label>
            <Input
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />
          </div>

          <div>
            <Label>Tipo de reserva</Label>
            <select
              className="w-full border rounded-md p-2 mt-1 bg-background"
              value={reservationType}
              onChange={(e) => resetForType(e.target.value as ReservationType)}
            >
              <option value="time">Horário</option>
              <option value="period">Período</option>
              <option value="day">Diária</option>
              <option value="full_property">Imóvel completo</option>
            </select>
          </div>

          <div>
            <Label>Forma de cobrança</Label>
            <select
              className="w-full border rounded-md p-2 mt-1 bg-background"
              value={billingMode}
              onChange={(e) => setBillingMode(e.target.value as BillingMode)}
            >
              <option value="one_time">Única</option>
              <option value="recurring">Recorrente</option>
            </select>
          </div>

          {billingMode === "recurring" && (
            <div>
              <Label>Quantidade de meses da recorrência</Label>
              <select
                className="w-full border rounded-md p-2 mt-1 bg-background"
                value={recurrenceMonths}
                onChange={(e) => setRecurrenceMonths(e.target.value)}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                  <option key={month} value={month}>
                    {month} mês{month > 1 ? "es" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {reservationType === "full_property" && (
            <div className="border rounded-xl p-4 space-y-4 bg-card">
              <div>
                <Label>Data de início</Label>
                <Input
                  type="date"
                  value={fullPropertyStartDate}
                  onChange={(e) => setFullPropertyStartDate(e.target.value)}
                />
              </div>

              {billingMode === "one_time" && (
                <div>
                  <Label>Quantidade de meses</Label>
                  <Input
                    type="number"
                    min="3"
                    value={monthsCount}
                    onChange={(e) => setMonthsCount(e.target.value)}
                  />
                </div>
              )}

              {billingMode === "recurring" && (
                <div className="text-sm text-muted-foreground">
                  A cobrança será mensal, sem cobrança total antecipada.
                </div>
              )}
            </div>
          )}

          {reservationType !== "full_property" &&
            items.map((item, index) => (
              <div key={item.id} className="border rounded-xl p-4 space-y-4 bg-card">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">
                    {reservationType === "day" ? `Dia ${index + 1}` : `Reserva ${index + 1}`}
                  </h4>

                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="text-sm text-red-500 flex items-center gap-1"
                    >
                      <Trash2 className="w-4 h-4" />
                      Remover
                    </button>
                  )}
                </div>

                <div>
                  <Label>Data da reserva</Label>
                  <Input
                    type="date"
                    value={item.date}
                    onChange={(e) => updateItem(item.id, { date: e.target.value })}
                  />
                </div>

                {reservationType === "time" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Hora inicial</Label>
                      <Input
                        type="time"
                        value={item.startTime}
                        onChange={(e) => updateItem(item.id, { startTime: e.target.value })}
                      />
                    </div>

                    <div>
                      <Label>Hora final</Label>
                      <Input
                        type="time"
                        value={item.endTime}
                        onChange={(e) => updateItem(item.id, { endTime: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                {reservationType === "period" && (
                  <div>
                    <div>
                      <Label>Período</Label>
                      <select
                        className="w-full border rounded-md p-2 mt-1 bg-background"
                        value={item.period}
                        onChange={(e) =>
                          updateItem(item.id, { period: e.target.value as PeriodType })
                        }
                      >
                        <option value="morning">Manhã</option>
                        <option value="afternoon">Tarde</option>
                        <option value="evening">Noite</option>
                      </select>
                    </div>

                    <div className="mt-3 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                      Horário fixo:
                      <span className="font-medium text-foreground ml-1">
                        {PERIOD_WINDOWS[item.period].start} às {PERIOD_WINDOWS[item.period].end}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}

          {canAddMore && billingMode === "one_time" && (
            <Button type="button" variant="outline" className="w-full" onClick={addItem}>
              <Plus className="w-4 h-4 mr-2" />
              Adicionar outro dia
            </Button>
          )}

          <Button
            variant="cta"
            className="w-full"
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processando...
              </>
            ) : (
              <>
                <Check className="w-4 h-4 mr-2" />
                Confirmar Reserva
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
```

Esse já deixa a recorrência semanal indo como mensalidade mensal.
O próximo arquivo, se você quiser seguir, é o `create-checkout-session.js`, porque ele precisa cobrar a recorrência mensal com base nas 4 semanas do mês.
