import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Patient, Infusion } from "@/data/dummyData";
import { User, Syringe, AlertCircle } from "lucide-react";
import { WaitingForDeviceModal } from "@/components/WaitingForDeviceModal";
import { InfusionDetails } from "@/lib/deviceApi";

interface WizardStep3Props {
  patientData: Partial<Patient>;
  infusionData: Partial<Infusion>;
  skippedPatient: boolean;
  deviceId: string;
  onConfirm: () => void;
  onBack: () => void;
  onDeviceConfirmed?: (infusionData: {
    deviceId: string;
    infusionId: string;
    status: string;
    timestamp: string;
  }) => void;
  onWizardClose?: () => void; // Add prop to close the wizard
  onRefetchDeviceDetails?: () => void; // New callback to refetch device details
}

export const WizardStep3 = ({
  patientData,
  infusionData,
  skippedPatient,
  deviceId,
  onConfirm,
  onBack,
  onDeviceConfirmed,
  onWizardClose,
  onRefetchDeviceDetails,
}: WizardStep3Props) => {
  const [confirmText, setConfirmText] = useState("");
  const [showWaitingModal, setShowWaitingModal] = useState(false);

  const isConfirmEnabled = confirmText.toLowerCase() === "start";

  const handleConfirm = () => {
    // Simultaneously: show modal AND call API
    console.log(
      "🚀 User confirmed - showing modal and calling API simultaneously"
    );
    setShowWaitingModal(true);
    onConfirm(); // Call API immediately
  };

  const handleDeviceConfirmation = (infusionData: {
    deviceId: string;
    infusionId: string;
    status: string;
    timestamp: string;
    infusionDetails?: InfusionDetails;
  }) => {
    setShowWaitingModal(false);

    // Close the wizard when device confirmation is received
    if (onWizardClose) {
      onWizardClose();
    }

    if (onDeviceConfirmed) {
      onDeviceConfirmed(infusionData);
    }
  };

  const handleStartMonitoring = (infusionData: {
    deviceId: string;
    infusionId: string;
    status: string;
    timestamp: string;
    infusionDetails?: InfusionDetails;
  }) => {
    console.log(
      "🎯 Starting monitoring mode with infusion data:",
      infusionData
    );
    setShowWaitingModal(false);

    // Close the wizard when monitoring starts
    if (onWizardClose) {
      onWizardClose();
    }

    // Navigate to monitoring/device dashboard
    if (onDeviceConfirmed) {
      onDeviceConfirmed(infusionData);
    }

    // You can add navigation logic here to go directly to monitoring view
    // For example: navigate(`/device/${infusionData.deviceId}/monitor`)
  };

  const handleCloseWaitingModal = () => {
    setShowWaitingModal(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (isConfirmEnabled) {
        handleConfirm();
      }
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6 py-3 sm:py-4">
      {/* Patient Summary */}
      <Card className="glass-dark">
        <div className="p-3 sm:p-4 space-y-3 sm:space-y-4">
          <div className="flex items-center gap-2 text-primary font-semibold text-sm sm:text-base">
            <User className="h-4 w-4 sm:h-5 sm:w-5" />
            <h3>Patient Information</h3>
            {skippedPatient && (
              <Badge variant="destructive" className="ml-auto text-xs">
                Skipped
              </Badge>
            )}
          </div>
          {!skippedPatient && patientData ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 text-xs sm:text-sm">
              <div>
                <p className="text-muted-foreground">Name</p>
                <p className="font-semibold">{patientData.name || "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Age</p>
                <p className="font-semibold">{patientData.age || "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Weight</p>
                <p className="font-semibold">
                  {patientData.weight ? `${patientData.weight} kg` : "—"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Bed No.</p>
                <p className="font-semibold">{patientData.bedNo || "—"}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-muted-foreground">Drug</p>
                <p className="font-semibold">
                  {patientData.drugInfused || "—"}
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-muted-foreground">Allergies</p>
                <p className="font-semibold">
                  {patientData.allergies || "None specified"}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs sm:text-sm text-muted-foreground">
              Patient details were skipped. Please ensure proper documentation.
            </p>
          )}
        </div>
      </Card>

      {/* Infusion Summary */}
      <Card className="glass-dark">
        <div className="p-3 sm:p-4 space-y-3 sm:space-y-4">
          <div className="flex items-center gap-2 text-primary font-semibold text-sm sm:text-base">
            <Syringe className="h-4 w-4 sm:h-5 sm:w-5" />
            <h3>Infusion Configuration</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 text-xs sm:text-sm">
            <div>
              <p className="text-muted-foreground">Flow Rate</p>
              <p className="font-semibold">
                {infusionData.flowRateMlMin} ml/min
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Time</p>
              <p className="font-semibold">{infusionData.plannedTimeMin} min</p>
            </div>
            <div>
              <p className="text-muted-foreground">Volume</p>
              <p className="font-semibold">{infusionData.plannedVolumeMl} ml</p>
            </div>
          </div>
          {infusionData.bolus?.enabled && (
            <div className="pt-2 border-t">
              <p className="text-xs sm:text-sm text-muted-foreground">
                Bolus Configuration
              </p>
              <p className="font-semibold text-primary text-sm">
                Enabled - {infusionData.bolus.volumeMl} ml initial bolus
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* Confirmation */}
      <Card className="glass-dark border-2 border-primary/20">
        <div className="p-3 sm:p-4 space-y-3 sm:space-y-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="space-y-2 flex-1">
              <Label
                htmlFor="confirm-start"
                className="text-sm sm:text-base font-semibold"
              >
                Type{" "}
                <span className="font-mono text-primary">
                  &quot;start&quot;
                </span>{" "}
                to confirm and begin infusion
              </Label>
              <Input
                id="confirm-start"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder='Type "start" here'
                className="h-10 sm:h-12 text-sm sm:text-base"
                autoFocus
              />
            </div>
          </div>
        </div>
      </Card>

      <div className="flex flex-col sm:flex-row gap-3 pt-4">
        <Button
          onClick={onBack}
          variant="outline"
          className="flex-1 h-10 sm:h-12 text-sm sm:text-base"
        >
          Back
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={!isConfirmEnabled}
          className="flex-1 h-10 sm:h-12 text-sm sm:text-base"
        >
          Confirm & Start Infusion
        </Button>
      </div>

      <WaitingForDeviceModal
        isOpen={showWaitingModal}
        onClose={handleCloseWaitingModal}
        deviceId={deviceId}
        onDeviceConfirmed={handleDeviceConfirmation}
        // onRefetchDeviceDetails={onRefetchDeviceDetails}
      />
    </div>
  );
};
