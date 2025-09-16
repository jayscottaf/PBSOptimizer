import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TrendingUp } from 'lucide-react';

export function SeniorityChart() {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">
            Seniority Trends
          </h3>
          <div className="flex items-center space-x-2">
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
              Your Range
            </Button>
            <Button variant="outline" size="sm">
              All Data
            </Button>
          </div>
        </div>

        {/* Chart placeholder */}
        <div className="relative h-64 bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-center">
          <div className="text-center">
            <TrendingUp className="mx-auto h-12 w-12 text-gray-300 mb-4" />
            <p className="text-gray-500">
              Seniority trend chart will display here
            </p>
            <p className="text-sm text-gray-400 mt-2">
              Shows historical award patterns for your seniority range
            </p>
          </div>

          {/* Mock chart elements */}
          <div className="absolute bottom-4 left-4 right-4">
            <div className="flex justify-between text-xs text-gray-400">
              <span>Jan</span>
              <span>Feb</span>
              <span>Mar</span>
              <span>Apr</span>
              <span>May</span>
              <span>Jun</span>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-4 text-center">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-2xl font-bold text-green-600">85%</div>
            <div className="text-sm text-gray-600">Avg Hold Rate</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-2xl font-bold text-blue-600">15,750</div>
            <div className="text-sm text-gray-600">Junior Holder</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-2xl font-bold text-gray-700">156</div>
            <div className="text-sm text-gray-600">Likely Trips</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
