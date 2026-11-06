// 기본기 모드 템플릿. Blink 와 DHT11 시리얼 출력은 제공된 원본 코드를 그대로 쓴다.

export interface BasicTemplate {
  id: string
  title: string
  summary: string
  /** 설명 탭 내용 */
  explanation: string[]
  code: string
  /** 시뮬레이터에 필요한 부품 */
  parts: string[]
}

export const BASIC_TEMPLATES: BasicTemplate[] = [
  {
    id: 'blink',
    title: 'Blink (내장 LED)',
    summary: '보드에 붙어 있는 LED 를 1초 간격으로 깜빡입니다.',
    explanation: [
      'Arduino UNO 의 내장 LED 는 13번 핀에 연결되어 있어요.',
      'LED_BUILTIN 은 보드 종류에 맞는 내장 LED 핀 번호로 자동 설정되는 상수입니다. (UNO 에서는 13)',
      'setup() 은 전원이 켜질 때 한 번, loop() 는 계속 반복 실행됩니다.',
      'delay(1000) 은 1000ms = 1초 동안 기다립니다.',
    ],
    parts: [],
    code: `void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}
void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(1000);
  digitalWrite(LED_BUILTIN, LOW);
  delay(1000);
}
`,
  },
  {
    id: 'external-led',
    title: '외부 LED 제어 (11번 핀)',
    summary: '브레드보드에 꽂은 LED 를 11번 핀으로 깜빡이고, PWM 으로 밝기도 바꿔 봅니다.',
    explanation: [
      'LED 긴 다리(+) → 220Ω 저항 → 11번 핀, 짧은 다리(−) → GND 로 연결합니다.',
      '저항이 없으면 전류가 너무 많이 흘러 LED 와 핀이 망가질 수 있어요.',
      '11번 핀은 ~ 표시가 있는 PWM 핀이라 analogWrite(0~255) 로 밝기 조절이 됩니다.',
    ],
    parts: ['led-red', 'res-220'],
    code: `const int ledPin = 11;   // LED 를 연결한 핀

void setup() {
  pinMode(ledPin, OUTPUT);   // LED 핀은 출력
}

void loop() {
  digitalWrite(ledPin, HIGH);   // LED 켜기
  delay(500);
  digitalWrite(ledPin, LOW);    // LED 끄기
  delay(500);

  analogWrite(ledPin, 50);      // 어둡게 (0~255)
  delay(500);
  analogWrite(ledPin, 255);     // 가장 밝게
  delay(500);
  analogWrite(ledPin, 0);       // 끄기
  delay(500);
}
`,
  },
  {
    id: 'serial',
    title: 'Serial 출력',
    summary: '시리얼 모니터에 글자와 숫자를 출력합니다. 센서 값 확인에 꼭 필요해요.',
    explanation: [
      'Serial.begin(9600) 으로 통신 속도를 맞춥니다. 시리얼 모니터도 9600 으로 설정해야 해요.',
      'Serial.print 는 줄바꿈 없이, Serial.println 은 출력 후 줄을 바꿉니다.',
      '센서 값을 시리얼로 찍어 보면 임계값을 정하기 쉬워요.',
    ],
    parts: [],
    code: `int count = 0;   // 몇 번째 출력인지 세는 변수

void setup() {
  Serial.begin(9600);            // 시리얼 통신 시작
  Serial.println("Hello Arduino!");
}

void loop() {
  Serial.print("count: ");       // 줄바꿈 없이 출력
  Serial.println(count);         // 값 출력 후 줄바꿈
  count++;                       // 1 증가
  delay(1000);
}
`,
  },
  {
    id: 'dht11-serial',
    title: 'DHT11 시리얼 출력',
    summary: 'DHT11.h 라이브러리로 온도와 습도를 읽어 시리얼 모니터에 출력합니다.',
    explanation: [
      'DHT11 의 DATA 핀을 2번에 연결합니다. VCC 는 5V, GND 는 GND.',
      'readTemperatureHumidity(temperature, humidity) 는 성공하면 0 을 돌려줍니다.',
      '실패하면 DHT11::getErrorString(result) 로 오류 내용을 볼 수 있어요.',
      'dht11.setDelay(500) 으로 측정 간격을 바꿀 수 있습니다. (주석 처리되어 있음)',
    ],
    parts: ['dht11'],
    code: `#include <DHT11.h>

DHT11 dht11(2);

void setup() {
    Serial.begin(9600);
    // dht11.setDelay(500);
}

void loop() {
    int temperature = 0;
    int humidity = 0;

    int result = dht11.readTemperatureHumidity(temperature, humidity);

    if (result == 0) {
        Serial.print("Temperature: ");
        Serial.print(temperature);
        Serial.print(" °C\\tHumidity: ");
        Serial.print(humidity);
        Serial.println(" %");
    } else {
        Serial.println(DHT11::getErrorString(result));
    }
}
`,
  },
]
