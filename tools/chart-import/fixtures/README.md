# 임포터 픽스처

**비어 있는 것이 정상이다** (P2.md 6.3).

어댑터는 `Adapter = (bytes, opts) => GgtoJson` 이고, **실제 샘플 파일이 이 디렉터리에 들어올 때
그 파일과 함께** 작성한다. 샘플 없이 쓴 변환기는 검증할 수 없고, 검증 못 한 변환기는 조용히
틀린 차트를 만들어 낸다 (그러면 뷰어도 트레이너도 거짓말을 한다).

P2 에서 시도한 것과 결과:

| 후보 | 상태 |
|---|---|
| `ggto-json` | 유일한 구현 어댑터 (항등 + 파싱). `src/adapters.ts` |
| `exinori/DCFR-SOLVER` (MIT) 6-max JSON 출력 | **샘플 확보 실패.** windows-gnu 툴체인에서 `windows-sys` 가 dlltool 을 요구해 빌드가 안 됐다. `docs/spikes/P4-rust.md` 3절 |
| PioSOLVER / GTO+ / HRC 출력 | 사용자가 소유한 솔버의 자기 솔브 결과가 생기면 그때 (DESIGN 4.2 의 2순위) |
| 상용 서비스(GTO Wizard 등) 추출 데이터 | **금지** (D15). 무료 구간이어도 넣지 않는다 |
