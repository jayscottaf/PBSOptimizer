
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProfileModal({ isOpen, onClose }: ProfileModalProps) {
  const [seniorityNumber, setSeniorityNumber] = useState("");
  const [seniorityPercentile, setSeniorityPercentile] = useState("");
  const [base, setBase] = useState("");
  const [aircraft, setAircraft] = useState("");

  useEffect(() => {
    if (isOpen) {
      // Load current values from localStorage
      setSeniorityNumber(localStorage.getItem('seniorityNumber') || "");
      setSeniorityPercentile(localStorage.getItem('seniorityPercentile') || "");
      setBase(localStorage.getItem('base') || "");
      setAircraft(localStorage.getItem('aircraft') || "");
    }
  }, [isOpen]);

  const handleSave = () => {
    // Validate inputs
    if (!seniorityNumber || !seniorityPercentile || !base || !aircraft) {
      toast({
        title: "Error",
        description: "Please fill in all fields",
        variant: "destructive"
      });
      return;
    }

    const percentile = parseFloat(seniorityPercentile);
    if (isNaN(percentile) || percentile < 0 || percentile > 100) {
      toast({
        title: "Error", 
        description: "Seniority percentile must be between 0 and 100",
        variant: "destructive"
      });
      return;
    }

    // Save to localStorage
    localStorage.setItem('seniorityNumber', seniorityNumber);
    localStorage.setItem('seniorityPercentile', seniorityPercentile);
    localStorage.setItem('base', base);
    localStorage.setItem('aircraft', aircraft);

    toast({
      title: "Success",
      description: "Profile updated successfully! Hold probabilities will be recalculated."
    });

    // Refresh the page to recalculate hold probabilities
    window.location.reload();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>User Profile</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div>
            <Label htmlFor="seniorityNumber">Seniority Number</Label>
            <Input
              id="seniorityNumber"
              value={seniorityNumber}
              onChange={(e) => setSeniorityNumber(e.target.value)}
              placeholder="e.g., 15860"
            />
          </div>

          <div>
            <Label htmlFor="seniorityPercentile">Seniority Percentile (%)</Label>
            <Input
              id="seniorityPercentile"
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={seniorityPercentile}
              onChange={(e) => setSeniorityPercentile(e.target.value)}
              placeholder="e.g., 3.5 for top 3.5%"
            />
            <div className="text-xs text-gray-500 mt-1">
              Lower % = more senior (e.g., 3% = top 3%, 97% = bottom 3%)
            </div>
          </div>

          <div>
            <Label htmlFor="base">Base</Label>
            <Input
              id="base"
              value={base}
              onChange={(e) => setBase(e.target.value)}
              placeholder="e.g., NYC"
            />
          </div>

          <div>
            <Label htmlFor="aircraft">Aircraft</Label>
            <Input
              id="aircraft"
              value={aircraft}
              onChange={(e) => setAircraft(e.target.value)}
              placeholder="e.g., A220"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              Save Profile
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
