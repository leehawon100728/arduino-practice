import { expect, it } from 'vitest'
import { josa } from './josa'

it('받침에 맞는 조사', () => {
  expect(josa('푸시버튼', '와과')).toBe('푸시버튼과')
  expect(josa('조도 센서', '와과')).toBe('조도 센서와')
  expect(josa('푸시버튼', '은는')).toBe('푸시버튼은')
  expect(josa('초음파 거리 센서', '이가')).toBe('초음파 거리 센서가')
  expect(josa('푸시버튼', '으로로')).toBe('푸시버튼으로')
  expect(josa('적외선 장애물 센서', '으로로')).toBe('적외선 장애물 센서로')
})
