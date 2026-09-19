import { Badge } from '@/components/ui/badge';
import { Lightbulb, ArrowRight, Sparkles } from 'lucide-react';

interface FollowUpSuggestionsProps {
  lastAssistantMessage: string;
  reportContext: 'single' | 'comparison' | 'none';
  onSelect: (suggestion: string) => void;
  /** Phase 2.4 — AI-generated follow-ups streamed from the edge function. When
   *  provided, these take precedence over the keyword heuristic. */
  aiSuggestions?: string[];
}

// Generate follow-up suggestions based on the last AI response
function generateSuggestions(content: string, context: 'single' | 'comparison' | 'none'): string[] {
  const lowerContent = content.toLowerCase();
  const suggestions: string[] = [];

  // Financial topics
  if (lowerContent.includes('yield') || lowerContent.includes('roi') || lowerContent.includes('return')) {
    suggestions.push('How does this compare to market averages?');
    suggestions.push('What factors could improve the yield?');
  }

  // Risk topics
  if (lowerContent.includes('risk') || lowerContent.includes('concern') || lowerContent.includes('issue')) {
    suggestions.push('How can these risks be mitigated?');
    suggestions.push('Which risk is most critical to address?');
  }

  // Location topics
  if (lowerContent.includes('location') || lowerContent.includes('suburb') || lowerContent.includes('area')) {
    suggestions.push('What about future development plans?');
    suggestions.push('How are the local schools and amenities?');
  }

  // Price/value topics
  if (lowerContent.includes('price') || lowerContent.includes('value') || lowerContent.includes('cost')) {
    suggestions.push('Is this property fairly priced?');
    suggestions.push('What are the expected capital gains?');
  }

  // Rental topics
  if (lowerContent.includes('rent') || lowerContent.includes('tenant') || lowerContent.includes('lease')) {
    suggestions.push('What is the vacancy rate in this area?');
    suggestions.push('How stable is rental demand here?');
  }

  // Comparison specific
  if (context === 'comparison') {
    suggestions.push('Which property offers better long-term value?');
    suggestions.push('Can you create a pros and cons table?');
  }

  // Default suggestions if none matched
  if (suggestions.length === 0) {
    if (context === 'comparison') {
      suggestions.push('Which property would you recommend?');
      suggestions.push('What are the key trade-offs?');
    } else if (context === 'single') {
      suggestions.push('What else should I know?');
      suggestions.push('Summarize the key investment points');
    } else {
      suggestions.push('Tell me more about this');
      suggestions.push('What should I consider next?');
    }
  }

  // Limit to 3 suggestions
  return suggestions.slice(0, 3);
}

export function FollowUpSuggestions({
  lastAssistantMessage,
  reportContext,
  onSelect,
  aiSuggestions,
}: FollowUpSuggestionsProps) {
  const cleanedAi = (aiSuggestions || [])
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0)
    .slice(0, 3);
  const useAi = cleanedAi.length > 0;
  const suggestions = useAi ? cleanedAi : generateSuggestions(lastAssistantMessage, reportContext);

  if (suggestions.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-border/30">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        {useAi ? <Sparkles className="h-3 w-3 text-primary" /> : <Lightbulb className="h-3 w-3" />}
        <span>{useAi ? 'Suggested follow-ups' : 'Follow-up questions'}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion, idx) => (
          <Badge
            key={idx}
            variant="secondary"
            className="cursor-pointer hover:bg-primary/10 hover:text-primary transition-colors py-1.5 px-3 text-xs font-normal"
            onClick={() => onSelect(suggestion)}
          >
            <ArrowRight className="h-3 w-3 mr-1.5 opacity-60" />
            {suggestion}
          </Badge>
        ))}
      </div>
    </div>
  );
}
