import { describe, expect, test } from 'bun:test'

import { parseStoredValue, serializeValue } from '@hooks'

import { defaultSetupFormValues } from './SetupForm'
import { setupConfigSchema } from './useSetupConfig'

describe('setupConfigSchema', () => {
  test('round-trips a stored config', () => {
    const config = { ...defaultSetupFormValues, pid: '12345' }
    expect(
      parseStoredValue(serializeValue(config), setupConfigSchema, defaultSetupFormValues)
    ).toEqual(config)
  })

  test('drops keys stored by older versions instead of resetting the config', () => {
    const config = { ...defaultSetupFormValues, pid: '12345' }
    const raw = serializeValue({ ...config, incentiveId: 'I1', removed: true })
    expect(parseStoredValue(raw, setupConfigSchema, defaultSetupFormValues)).toEqual(config)
  })
})
