import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ReportFormatConfig {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
}

interface ReportFormatGroupProps {
  title: string;
  description: string;
  icon: React.ElementType;
  formats: ReportFormatConfig[];
  selectedFormat: string | null;
  onSelectFormat: (id: string | null) => void;
  getCount: (format: ReportFormatConfig) => number;
  columns?: 2 | 3;
}

export function ReportFormatGroup({
  title,
  description,
  icon: GroupIcon,
  formats,
  selectedFormat,
  onSelectFormat,
  getCount,
  columns = 3,
}: ReportFormatGroupProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GroupIcon className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className={`grid gap-3 sm:gap-4 grid-cols-1 ${columns === 3 ? 'sm:grid-cols-2 md:grid-cols-3' : 'sm:grid-cols-2'}`}>
          {formats.map((format) => {
            const Icon = format.icon;
            const count = getCount(format);
            const isSelected = selectedFormat === format.id;

            return (
              <Card
                key={format.id}
                className={`cursor-pointer transition-all hover:border-primary/50 ${
                  isSelected ? 'border-primary ring-2 ring-primary/20' : ''
                }`}
                onClick={() => onSelectFormat(isSelected ? null : format.id)}
              >
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold">{format.label}</h3>
                        <p className="text-sm text-muted-foreground">{format.description}</p>
                      </div>
                    </div>
                    <Badge variant="secondary">{count}</Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
