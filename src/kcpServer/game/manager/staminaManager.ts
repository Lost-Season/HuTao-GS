import BaseClass from '#/baseClass'
import VehicleStamina from '#/packets/VehicleStamina'
import Avatar from '$/entity/avatar'
import Vehicle from '$/entity/gadget/vehicle'
import { PlayerPropEnum } from '@/types/enum'
import { ChangeHpReasonEnum, MotionStateEnum } from '@/types/proto/enum'

const UPDATE_INTERVAL = 200
const RECOVER_AMOUNT = 500

export default class StaminaManager extends BaseClass {
  entity: Avatar | Vehicle

  startConsumeTime: number | null
  startRecoverTime: number | null

  consumeAmount: number

  timer: NodeJS.Timer

  constructor(entity: Avatar | Vehicle) {
    super()

    this.entity = entity

    this.startConsumeTime = null
    this.startRecoverTime = null

    this.consumeAmount = 0

    this.timer = null

    super.initHandlers(entity)
  }

  private get sceneTime() {
    return this.entity?.manager?.scene?.sceneTime || null
  }

  get maxStamina() {
    const { entity } = this
    return entity.player.props.get(PlayerPropEnum.PROP_MAX_STAMINA)
  }

  get curStamina() {
    const { entity } = this
    const propType = entity instanceof Vehicle ? PlayerPropEnum.PROP_CUR_TEMPORARY_STAMINA : PlayerPropEnum.PROP_CUR_PERSIST_STAMINA
    return entity.player.props.get(propType)
  }

  private async tick() {
    const amount = this.calcRecoverAmount() - this.calcConsumeAmount()
    if (amount === 0) return

    await this.setRelativeStamina(amount)

    const { entity, maxStamina, curStamina } = this
    if (!entity.isAlive() || curStamina > 0) return

    if (entity instanceof Avatar && MotionStateEnum[entity.motion.state].includes('SWIM')) {
      this.startConsumeTime = null
      await this.setStamina(maxStamina)
      await entity.player.returnToSafePos(ChangeHpReasonEnum.CHANGE_HP_SUB_DRAWN)
    }
  }

  private async startConsume(value: number, burst?: number) {
    await this.stopConsume()
    await this.stopRecover()

    const { startConsumeTime, sceneTime } = this
    if (startConsumeTime != null || sceneTime == null) return

    if (burst) await this.setRelativeStamina(-burst)

    this.startConsumeTime = burst ? sceneTime + 1e3 : sceneTime
    this.consumeAmount = value
  }

  private async stopConsume() {
    const { startConsumeTime } = this
    if (startConsumeTime == null) return

    await this.tick()
    this.startConsumeTime = null
  }

  private async startRecover(delayed: boolean = false) {
    await this.stopConsume()

    const { startRecoverTime, sceneTime } = this
    if (startRecoverTime != null || sceneTime == null) return

    this.startRecoverTime = delayed ? sceneTime + 1e3 : sceneTime
  }

  private async stopRecover() {
    const { startRecoverTime } = this
    if (startRecoverTime == null) return

    await this.tick()
    this.startRecoverTime = null
  }

  private calcConsumeAmount(): number {
    const { startConsumeTime, consumeAmount, sceneTime } = this

    if (startConsumeTime == null) return 0
    const duration = Math.max(0, sceneTime - startConsumeTime)

    this.startConsumeTime = sceneTime
    return (duration / UPDATE_INTERVAL) * consumeAmount
  }

  private calcRecoverAmount(): number {
    const { startRecoverTime, sceneTime } = this

    if (startRecoverTime == null) return 0
    const duration = Math.max(0, sceneTime - startRecoverTime)

    this.startRecoverTime = sceneTime
    return (duration / UPDATE_INTERVAL) * RECOVER_AMOUNT
  }

  start() {
    if (this.timer) this.stop()
    this.timer = setInterval(this.tick.bind(this), UPDATE_INTERVAL)
  }

  stop() {
    const { timer } = this
    if (timer == null) return

    clearInterval(timer)
    this.timer = null
  }

  async setRelativeStamina(value: number) {
    const { maxStamina, curStamina } = this

    if (
      value === 0 ||
      (curStamina <= 0 && value < 0) ||
      (curStamina >= maxStamina && value > 0)
    ) return

    await this.setStamina(curStamina + value)
  }

  async setStamina(value: number) {
    const { entity, maxStamina } = this
    const { manager, player, godMode } = entity

    if (godMode) return

    value = Math.max(0, Math.min(maxStamina, value))

    if (entity instanceof Avatar) {
      await player.props.set(PlayerPropEnum.PROP_CUR_PERSIST_STAMINA, value, true)
    } else if (entity instanceof Vehicle) {
      await player.props.set(PlayerPropEnum.PROP_CUR_TEMPORARY_STAMINA, value)
      if (manager) await VehicleStamina.broadcastNotify(manager.scene.broadcastContextList, entity)
    }
  }

  /**Events**/

  // MotionStateChanged
  async handleMotionStateChanged(state: MotionStateEnum) {
    switch (state) {
      case MotionStateEnum.MOTION_DASH:
      case MotionStateEnum.MOTION_DANGER_DASH:
        await this.startConsume(360)
        break
      case MotionStateEnum.MOTION_DASH_BEFORE_SHAKE:
        await this.startConsume(0, 1800)
        break
      case MotionStateEnum.MOTION_CLIMB:
        await this.startConsume(150)
        break
      case MotionStateEnum.MOTION_CLIMB_JUMP:
        await this.startConsume(0, 2500)
        break
      case MotionStateEnum.MOTION_FLY:
      case MotionStateEnum.MOTION_FLY_FAST:
      case MotionStateEnum.MOTION_FLY_SLOW:
        await this.startConsume(60)
        break
      case MotionStateEnum.MOTION_SWIM_DASH:
        await this.startConsume(204, 2000)
        break
      case MotionStateEnum.MOTION_SWIM_MOVE:
        await this.startConsume(80)
        break
      case MotionStateEnum.MOTION_SLIP:
      case MotionStateEnum.MOTION_LADDER_SLIP:
      case MotionStateEnum.MOTION_FLY_IDLE:
      case MotionStateEnum.MOTION_SWIM_IDLE:
        await this.stopConsume()
        await this.stopRecover()
        break
      case MotionStateEnum.MOTION_SKIFF_DASH:
        await this.startConsume(204)
        break
      case MotionStateEnum.MOTION_POWERED_FLY:
      case MotionStateEnum.MOTION_SKIFF_POWERED_DASH:
        this.startRecover()
        break
      default:
        this.startRecover(true)
        break
    }
  }

  // OnScene
  async handleOnScene() {
    this.start()
  }

  // OffScene
  async handleOffScene() {
    this.stop()
  }
}