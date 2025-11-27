import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Infusion } from "@/data/dummyData";
import { AlertCircle, Calculator } from "lucide-react";

interface WizardStep2Props {
  onComplete: (data: Partial<Infusion>) => void;
  onBack: () => void;
}

export const WizardStep2 = ({ onComplete, onBack }: WizardStep2Props) => {
  const [flowRate, setFlowRate] = useState<number | undefined>();
  const [time, setTime] = useState<number | undefined>();
  const [volume, setVolume] = useState<number | undefined>();
  const [bolusEnabled, setBolusEnabled] = useState(false);
  const [bolusVolume, setBolusVolume] = useState(0);
  const [autoCalcMessage, setAutoCalcMessage] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);

  useEffect(() => {
    if (isCalculating) return; // Prevent infinite loops during auto-calculation

    // Clear previous messages and errors
    const errors: string[] = [];
    setAutoCalcMessage("");

    // Validate flow rate
    if (flowRate !== undefined && flowRate <= 0) {
      errors.push("Flow rate must be greater than 0");
    }

    // Validate time
    if (time !== undefined && time <= 0) {
      errors.push("Time must be greater than 0");
    }

    // Validate volume
    if (volume !== undefined && volume <= 0) {
      errors.push("Volume must be greater than 0");
    }

    setValidationErrors(errors);

    if (errors.length > 0) return;

    // Count how many fields have valid values
    const hasFlowRate = flowRate !== undefined && flowRate > 0;
    const hasTime = time !== undefined && time > 0;
    const hasVolume = volume !== undefined && volume > 0;
    const filledFields = [hasFlowRate, hasTime, hasVolume].filter(
      Boolean
    ).length;

    // Check mathematical consistency when all 3 fields are filled
    if (filledFields === 3) {
      // Use Volume as basis: Time should equal Volume ÷ Flow Rate
      const expectedTime = Math.round((volume! / flowRate!) * 100) / 100;
      const timeDifference = Math.abs(time! - expectedTime);

      if (timeDifference > 0.01) {
        // Allow small rounding differences
        const correctedTime = expectedTime;
        setAutoCalcMessage(
          `⚠️ Values don't match! Volume ÷ Flow Rate = ${volume} ÷ ${flowRate} = ${correctedTime} min, but Time is ${time} min. Time should be ${correctedTime} min.`
        );

        // Auto-correct the time to the calculated value
        setTime(correctedTime);
      } else {
        setAutoCalcMessage(
          `✅ Values are mathematically consistent: ${volume} ml ÷ ${flowRate} ml/min = ${time} min`
        );
      }
    }

    // Auto-calculate when exactly 2 fields are filled (prioritize Flow Rate + Volume → Time)
    if (filledFields === 2) {
      setIsCalculating(true);

      if (hasFlowRate && hasVolume && !hasTime) {
        // Primary calculation: Time = Volume ÷ Flow Rate
        const calculated = Math.round((volume! / flowRate!) * 100) / 100; // Round to 2 decimal places
        setTime(calculated);
        setAutoCalcMessage(
          `Time auto-calculated: ${calculated} min = ${volume} ml ÷ ${flowRate} ml/min`
        );
      } else if (hasFlowRate && hasTime && !hasVolume) {
        // Calculate Volume = Flow Rate × Time
        const calculated = Math.round(flowRate! * time! * 100) / 100; // Round to 2 decimal places
        setVolume(calculated);
        setAutoCalcMessage(
          `Volume auto-calculated: ${calculated} ml = ${flowRate} ml/min × ${time} min`
        );
      } else if (hasTime && hasVolume && !hasFlowRate) {
        // Calculate Flow Rate = Volume ÷ Time
        const calculated = Math.round((volume! / time!) * 100) / 100; // Round to 2 decimal places
        setFlowRate(calculated);
        setAutoCalcMessage(
          `Flow rate auto-calculated: ${calculated} ml/min = ${volume} ml ÷ ${time} min`
        );
      }

      setTimeout(() => setIsCalculating(false), 100); // Reset after a short delay
    }
  }, [flowRate, time, volume, isCalculating]);

  const handleClearAll = () => {
    setFlowRate(undefined);
    setTime(undefined);
    setVolume(undefined);
    setBolusEnabled(false);
    setBolusVolume(0);
    setAutoCalcMessage("");
    setValidationErrors([]);
  };

  const handleFlowRateChange = (value: string) => {
    const numValue = parseFloat(value) || undefined;
    setFlowRate(numValue);
  };

  const handleTimeChange = (value: string) => {
    const numValue = parseFloat(value) || undefined;
    setTime(numValue);
  };

  const handleVolumeChange = (value: string) => {
    const numValue = parseFloat(value) || undefined;
    setVolume(numValue);
  };

  const handleProceed = () => {
    if (!flowRate || !time || !volume || validationErrors.length > 0) return;

    const infusionData: Partial<Infusion> = {
      flowRateMlMin: flowRate,
      plannedTimeMin: time,
      plannedVolumeMl: volume,
      bolus: {
        enabled: bolusEnabled,
        volumeMl: bolusEnabled ? bolusVolume : 0,
      },
    };

    onComplete(infusionData);
  };

  const isValid =
    flowRate &&
    flowRate > 0 &&
    time &&
    time > 0 &&
    volume &&
    volume > 0 &&
    validationErrors.length === 0;

  return (
    <div className="space-y-4 sm:space-y-6 py-3 sm:py-4">
      {/* Info box about auto-calculation */}
      <div className="flex items-start gap-2 bg-blue-50 dark:bg-blue-950/20 p-3 sm:p-4 rounded-lg text-xs sm:text-sm border border-blue-200 dark:border-blue-800">
        <Calculator className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-blue-800 dark:text-blue-200">
            <strong>Auto-calculation:</strong> Fill any 2 fields and the third
            will be calculated automatically. Primary workflow: Enter Flow Rate
            and Volume to calculate Time (Time = Volume ÷ Flow Rate).
          </p>
        </div>
        <Button
          onClick={handleClearAll}
          variant="outline"
          size="sm"
          className="ml-2 h-6 px-2 text-xs border-blue-300 hover:bg-blue-100 dark:border-blue-700 dark:hover:bg-blue-900"
        >
          Clear All
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <div className="space-y-2">
          <Label htmlFor="flow-rate" className="text-sm sm:text-base">
            Flow Rate (ml/min) <span className="text-destructive">*</span>
          </Label>
          <Input
            id="flow-rate"
            type="number"
            step="0.1"
            min="0.1"
            value={flowRate || ""}
            onChange={(e) => handleFlowRateChange(e.target.value)}
            placeholder="ml/min"
            className="h-10 sm:h-12 text-sm sm:text-base"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="volume" className="text-sm sm:text-base">
            Volume (ml) <span className="text-destructive">*</span>
          </Label>
          <Input
            id="volume"
            type="number"
            step="0.1"
            min="0.1"
            value={volume || ""}
            onChange={(e) => handleVolumeChange(e.target.value)}
            placeholder="ml"
            className="h-10 sm:h-12 text-sm sm:text-base"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="time" className="text-sm sm:text-base">
            Time (min) <span className="text-destructive">*</span>
          </Label>
          <Input
            id="time"
            type="number"
            step="0.1"
            min="0.1"
            value={time || ""}
            onChange={(e) => handleTimeChange(e.target.value)}
            placeholder="Minutes"
            className="h-10 sm:h-12 text-sm sm:text-base"
          />
        </div>
      </div>

      {autoCalcMessage && (
        <div className="flex items-start gap-2 bg-primary/10 p-3 sm:p-4 rounded-lg text-xs sm:text-sm">
          <Calculator className="h-4 w-4 sm:h-5 sm:w-5 text-primary flex-shrink-0 mt-0.5" />
          <p className="text-primary font-medium">{autoCalcMessage}</p>
        </div>
      )}

      {validationErrors.length > 0 && (
        <div className="flex items-start gap-2 bg-destructive/10 p-3 sm:p-4 rounded-lg text-xs sm:text-sm">
          <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 text-destructive flex-shrink-0 mt-0.5" />
          <div>
            {validationErrors.map((error, index) => (
              <p key={index} className="text-destructive">
                {error}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Bolus Section */}
      <div className="space-y-3 sm:space-y-4 p-3 sm:p-4 border rounded-lg">
        <div className="flex items-center justify-between">
          <Label
            htmlFor="bolus-enabled"
            className="text-sm sm:text-base font-semibold"
          >
            Enable Bolus
          </Label>
          <Switch
            id="bolus-enabled"
            checked={bolusEnabled}
            onCheckedChange={setBolusEnabled}
          />
        </div>

        {bolusEnabled && volume && (
          <div className="space-y-3 pt-2">
            <Label className="text-sm sm:text-base">
              Bolus Volume: {bolusVolume.toFixed(1)} ml
            </Label>
            <Slider
              value={[bolusVolume]}
              onValueChange={(values) => setBolusVolume(values[0])}
              max={volume}
              step={0.5}
              className="py-3 sm:py-4"
            />
            <p className="text-xs text-muted-foreground">
              Bolus will deliver the initial portion at a higher rate for faster
              onset
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 pt-4">
        <Button
          onClick={onBack}
          variant="outline"
          className="flex-1 h-10 sm:h-12 text-sm sm:text-base"
        >
          Back
        </Button>
        <Button
          onClick={handleProceed}
          disabled={!isValid}
          className="flex-1 h-10 sm:h-12 text-sm sm:text-base"
        >
          Proceed Next
        </Button>
      </div>
    </div>
  );
};
