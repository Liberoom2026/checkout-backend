import { useState } from "react";
import { ImageGalleryTrigger } from "@/components/ImageGallery";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Space } from "@/types/space";
import { MapPin, Loader2, Check } from "lucide-react";
import { toast } from "sonner";

interface ReservationModalProps {
  space: Space | null;
  isOpen: boolean;
  onClose: () => void;
}

type ReservationType = "time" | "period" | "day" | "full_property";
type PeriodType = "morning" | "afternoon" | "evening";
type BillingMode = "one_time" | "recurring";

const API_URL = "https://checkout-backend-beta.vercel.app/api/create-checkout-session";

export const ReservationModal = ({ space, isOpen, onClose }: ReservationModalProps) => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
  });

  const [reservationType, setReservationType] = useState<ReservationType>("time");
  const [billingMode, setBillingMode] = useState<BillingMode>("one_time");
  const [period, setPeriod] = useState<PeriodType>("morning");
  const [reservationDate, setReservationDate] = useState("");
  const [durationHours, setDurationHours] = useState("1");
  const [daysCount, setDaysCount] = useState("1");
  const [monthsCount, setMonthsCount] = useState("3");

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!space) return;

    if (!formData.name || !formData.email) {
      toast.error("Preencha seus dados");
      return;
    }

    const payload: Record<string, any> = {
      property_id: space.id,
      guest_name: formData.name,
      guest_email: formData.email,
      phone: formData.phone || "",
      billing_mode: billingMode,
      reservation_type: reservationType,
      date: reservationDate || null,
    };

    if (reservationType === "time") {
      const hours = Number(durationHours);
      if (!hours || hours <= 0) {
        toast.error("Informe a quantidade de horas");
        return;
      }
      payload.duration_hours = hours;
    }

    if (reservationType === "period") {
      payload.period = period;
      payload.duration_hours = Number(durationHours) > 0 ? Number(durationHours) : 4;
    }

    if (reservationType === "day") {
      const days = Number(daysCount);
      if (!days || days <= 0) {
        toast.error("Informe a quantidade de dias");
        return;
      }
      payload.days_count = days;
    }

    if (reservationType === "full_property") {
      const months = Number(monthsCount);
      if (!months || months < 3) {
        toast.error("Imóvel completo exige no mínimo 3 meses");
        return;
      }
      payload.months_count = months;
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Reservar Espaço</DialogTitle>
        </DialogHeader>

        <div className="flex gap-4 p-4 bg-muted rounded-xl mb-4">
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
            <Label>Data da reserva</Label>
            <Input
              type="date"
              value={reservationDate}
              onChange={(e) => setReservationDate(e.target.value)}
            />
          </div>

          <div>
            <Label>Tipo de reserva</Label>
            <select
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={reservationType}
              onChange={(e) => setReservationType(e.target.value as ReservationType)}
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
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={billingMode}
              onChange={(e) => setBillingMode(e.target.value as BillingMode)}
            >
              <option value="one_time">Única</option>
              <option value="recurring">Recorrente</option>
            </select>
          </div>

          {reservationType === "time" && (
            <div>
              <Label>Duração em horas</Label>
              <Input
                type="number"
                min="1"
                value={durationHours}
                onChange={(e) => setDurationHours(e.target.value)}
              />
            </div>
          )}

          {reservationType === "period" && (
            <>
              <div>
                <Label>Período</Label>
                <select
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value as PeriodType)}
                >
                  <option value="morning">Manhã</option>
                  <option value="afternoon">Tarde</option>
                  <option value="evening">Noite</option>
                </select>
              </div>

              <div>
                <Label>Duração em horas</Label>
                <Input
                  type="number"
                  min="1"
                  value={durationHours}
                  onChange={(e) => setDurationHours(e.target.value)}
                />
              </div>
            </>
          )}

          {reservationType === "day" && (
            <div>
              <Label>Quantidade de dias</Label>
              <Input
                type="number"
                min="1"
                value={daysCount}
                onChange={(e) => setDaysCount(e.target.value)}
              />
            </div>
          )}

          {reservationType === "full_property" && (
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
