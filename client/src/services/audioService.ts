/**
 * Audio Service for playing notification sounds
 * Handles warning sounds for device errors and notifications
 */

export type SoundType = "error" | "warning" | "info" | "success";

interface ToneConfig {
  frequency: number;
  duration: number;
  pause?: number;
}

interface SoundConfig {
  volume: number;
  tones: ToneConfig[];
}

class AudioService {
  private context: AudioContext | null = null;
  private isEnabled: boolean = true;
  private volume: number = 0.5;

  constructor() {
    // Initialize audio context when first needed
    this.initializeAudioContext();
  }

  private initializeAudioContext() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.context = new (
        window.AudioContext || (window as any).webkitAudioContext
      )();
    } catch (error) {
      console.warn("Web Audio API not supported:", error);
      this.context = null;
    }
  }

  /**
   * Generate and play a warning tone
   */
  async playWarningSound(type: SoundType = "warning") {
    if (!this.isEnabled || !this.context) return;

    try {
      // Resume audio context if suspended (required by some browsers)
      if (this.context.state === "suspended") {
        await this.context.resume();
      }

      const oscillator = this.context.createOscillator();
      const gainNode = this.context.createGain();

      // Connect audio nodes
      oscillator.connect(gainNode);
      gainNode.connect(this.context.destination);

      // Configure sound based on type
      const soundConfig = this.getSoundConfig(type);

      // Set initial volume
      gainNode.gain.setValueAtTime(0, this.context.currentTime);
      gainNode.gain.linearRampToValueAtTime(
        this.volume * soundConfig.volume,
        this.context.currentTime + 0.01
      );

      // Play the tone sequence
      let currentTime = this.context.currentTime;

      for (const tone of soundConfig.tones) {
        oscillator.frequency.setValueAtTime(tone.frequency, currentTime);
        oscillator.frequency.linearRampToValueAtTime(
          tone.frequency,
          currentTime + tone.duration
        );
        currentTime += tone.duration;

        if (tone.pause) {
          gainNode.gain.linearRampToValueAtTime(0, currentTime);
          currentTime += tone.pause;
          gainNode.gain.linearRampToValueAtTime(
            this.volume * soundConfig.volume,
            currentTime
          );
        }
      }

      // Fade out
      gainNode.gain.linearRampToValueAtTime(0, currentTime + 0.1);

      // Start and stop the oscillator
      oscillator.start(this.context.currentTime);
      oscillator.stop(currentTime + 0.1);

      console.log(`🔊 Played ${type} notification sound`);
    } catch (error) {
      console.error("Failed to play warning sound:", error);
    }
  }

  /**
   * Get sound configuration for different notification types
   */
  private getSoundConfig(type: SoundType): SoundConfig {
    const configs: Record<SoundType, SoundConfig> = {
      error: {
        volume: 0.8,
        tones: [
          { frequency: 800, duration: 0.2 },
          { frequency: 600, duration: 0.2, pause: 0.1 },
          { frequency: 800, duration: 0.2 },
        ],
      },
      warning: {
        volume: 0.6,
        tones: [
          { frequency: 600, duration: 0.3 },
          { frequency: 400, duration: 0.3, pause: 0.1 },
        ],
      },
      info: {
        volume: 0.4,
        tones: [{ frequency: 500, duration: 0.2 }],
      },
      success: {
        volume: 0.5,
        tones: [
          { frequency: 400, duration: 0.1 },
          { frequency: 500, duration: 0.1 },
          { frequency: 600, duration: 0.2 },
        ],
      },
    };

    return configs[type] || configs.info;
  }

  /**
   * Play notification sound based on priority level
   */
  async playNotificationSound(priority: "critical" | "warning" | "info") {
    const soundMap: Record<string, SoundType> = {
      critical: "error",
      warning: "warning",
      info: "info",
    };

    await this.playWarningSound(soundMap[priority] || "info");
  }

  /**
   * Enable or disable sound notifications
   */
  setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
    localStorage.setItem("audioNotifications", enabled.toString());
  }

  /**
   * Get current sound enabled status
   */
  getEnabled(): boolean {
    const stored = localStorage.getItem("audioNotifications");
    if (stored !== null) {
      this.isEnabled = stored === "true";
    }
    return this.isEnabled;
  }

  /**
   * Set volume level (0.0 to 1.0)
   */
  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    localStorage.setItem("audioVolume", this.volume.toString());
  }

  /**
   * Get current volume level
   */
  getVolume(): number {
    const stored = localStorage.getItem("audioVolume");
    if (stored !== null) {
      this.volume = parseFloat(stored);
    }
    return this.volume;
  }

  /**
   * Test audio functionality
   */
  async testSound() {
    await this.playWarningSound("warning");
  }
}

// Create and export singleton instance
const audioService = new AudioService();

// Initialize settings from localStorage
audioService.getEnabled();
audioService.getVolume();

export default audioService;
