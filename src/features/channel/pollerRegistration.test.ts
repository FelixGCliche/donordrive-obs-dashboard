import { describe, expect, test } from 'bun:test'

import { DOCK_ROLE, parseDockRegistration } from './pollerRegistration'

const parse = (query: string) => parseDockRegistration(new URLSearchParams(query))

describe('parseDockRegistration', () => {
  test('returns the participant for a valid dock registration', () => {
    expect(parse(`role=${DOCK_ROLE}&host=extralife&pid=12345`)).toEqual({
      host: 'extralife',
      pid: '12345',
    })
    expect(parse('role=dock&host=try&pid=abc-1&extra=1')).toEqual({ host: 'try', pid: 'abc-1' })
  })

  test('ignores sockets without the dock role', () => {
    expect(parse('host=extralife&pid=12345')).toBeUndefined()
    expect(parse('role=overlay&host=extralife&pid=12345')).toBeUndefined()
    expect(parse('role=DOCK&host=extralife&pid=12345')).toBeUndefined()
  })

  test('rejects unknown hosts', () => {
    expect(parse('role=dock&host=example&pid=12345')).toBeUndefined()
  })

  test('rejects invalid participant ids', () => {
    expect(parse('role=dock&host=extralife&pid=12%2F34')).toBeUndefined()
    expect(parse('role=dock&host=extralife&pid=')).toBeUndefined()
    expect(parse(`role=dock&host=extralife&pid=${'1'.repeat(65)}`)).toBeUndefined()
  })

  test('rejects a missing host or pid', () => {
    expect(parse('role=dock&pid=12345')).toBeUndefined()
    expect(parse('role=dock&host=extralife')).toBeUndefined()
  })
})
