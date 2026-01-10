import {
  Icon123,
  IconBrackets,
  IconCalendar,
  IconCheck,
  IconClock,
  IconCode,
  IconLetterCaseToggle,
  IconNumber10,
  IconQuestionMark,
} from '@tabler/icons-react';
import type { ReactElement } from 'react';

import type { NormalizedSQLType } from '@vacp/debug-ui/ui/sql/types';

export function ColumnTypeIcon({
  type,
  className,
}: {
  type: NormalizedSQLType;
  className?: string;
}): ReactElement {
  const props = { size: 14, className };
  switch (type) {
    case 'float':
    case 'decimal':
    case 'integer':
    case 'bigint':
      return <Icon123 {...props} />;
    case 'boolean':
      return <IconCheck {...props} />;
    case 'date':
    case 'timestamp':
    case 'timestamptz':
      return <IconCalendar {...props} />;
    case 'time':
    case 'timetz':
    case 'interval':
      return <IconClock {...props} />;
    case 'string':
      return <IconLetterCaseToggle {...props} />;
    case 'bytes':
    case 'bitstring':
      return <IconNumber10 {...props} />;
    case 'array':
      return <IconBrackets {...props} />;
    case 'object':
      return <IconCode {...props} />;
    case 'other':
      return <IconQuestionMark {...props} />;
    default: {
      const _exhaustive: never = type;
      return <IconQuestionMark {...props} />;
    }
  }
}

