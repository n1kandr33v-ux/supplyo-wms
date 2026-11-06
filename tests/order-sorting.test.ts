import assert from 'node:assert/strict'
import test from 'node:test'
import { sortOrders } from '../src/lib/order-sorting.ts'

const rows = [
  { id: 1, address: 'A-10', ready: true },
  { id: 2, address: 'A-2', ready: false },
  { id: 3, address: 'B-1', ready: false, assemblyStatus: 'error' as const },
  { id: 4, address: 'A-1', ready: false, assemblyStatus: 'kiz-error' as const },
  { id: 5, address: 'A-3', ready: false, assemblyStatus: 'checking' as const },
]
test('attention sorts errors before waiting, checking and ready', () => {
  assert.deepEqual(sortOrders(rows, 'attention').map(r=>r.id), [3,4,2,5,1])
})
test('ready sorts completed orders first', () => {
  assert.deepEqual(sortOrders(rows, 'ready').map(r=>r.id), [1,5,2,4,3])
})
test('reset uses natural address order and never mutates source rows', () => {
  assert.deepEqual(sortOrders(rows, 'address').map(r=>r.id), [4,2,5,1,3])
  assert.deepEqual(rows.map(r=>r.id), [1,2,3,4,5])
})
test('explicit status takes precedence over legacy ready flag', () => {
  assert.deepEqual(sortOrders([{id:1,address:'A-1',ready:true,assemblyStatus:'error'},{id:2,address:'A-1',ready:true}], 'attention').map(r=>r.id), [1,2])
  assert.deepEqual(sortOrders([], 'ready'), [])
})
