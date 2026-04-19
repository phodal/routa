---
title: Disabled Providers
---

# Disabled Providers Feature

## Overview

This feature allows users to disable specific ACP providers that may cause errors (e.g., 403 Forbidden, authentication issues) to prevent them from appearing in provider selection lists throughout the application.

## Problem

Some ACP providers may not be accessible to all users due to:
- Authentication/permission issues (403 Forbidden)
- Network restrictions
- Subscription/license limitations
- Regional availability

When these providers are attempted to be used, they generate errors like:
```
ACP Error [-32603]: Internal error: Permission denied: HTTP error: 403 Forbidden
```

## Solution

Users can now disable problematic providers through the Settings panel, which will:
1. Hide them from all provider selection dropdowns
2. Prevent automatic selection of disabled providers
3. Persist the disabled state across sessions

## Usage

### Disabling a Provider

1. Open Settings (gear icon)
2. Navigate to the "Providers" tab
3. Scroll to the "Disabled Providers" section
4. Check the checkbox next to any provider you want to disable
5. Refresh the page to apply changes

### Re-enabling a Provider

1. Open Settings → Providers tab
2. In the "Disabled Providers" section, uncheck the provider
3. Refresh the page to apply changes

## Implementation Details

### Storage

Disabled provider IDs are stored in localStorage under the key `routa.disabledProviders`:

```typescript
// Example stored value
["kiro", "qoder", "auggie"]
```

### Filtering

Providers are filtered at multiple points:
- `useAcp` hook: Filters providers when loading from backend
- Provider lists: All provider lists respect the disabled state

### API

New utility functions in `src/client/utils/custom-acp-providers.ts`:

```typescript
// Load disabled provider IDs
loadDisabledProviders(): string[]

// Save disabled provider IDs
saveDisabledProviders(providerIds: string[]): void

// Check if a provider is disabled
isProviderDisabled(providerId: string): boolean

// Disable a provider
disableProvider(providerId: string): void

// Enable a provider
enableProvider(providerId: string): void

// Toggle a provider's disabled state
toggleProviderDisabled(providerId: string): boolean
```

## Files Modified

1. `src/client/utils/custom-acp-providers.ts` - Added disabled providers management functions
2. `src/client/hooks/use-acp.ts` - Filter disabled providers when loading
3. `src/client/components/settings-panel.tsx` - Added UI for managing disabled providers

## Future Enhancements

- Auto-disable providers that consistently fail authentication
- Provider-specific error messages in the disabled providers list
- Bulk enable/disable operations
- Export/import disabled providers configuration

