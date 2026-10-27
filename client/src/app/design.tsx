import { Redirect } from 'expo-router';
import { Text, View } from 'react-native';
import {
  BalanceCard, Button, Field, GuideBubble, Notice, Screen, ServiceTile, ServiceTiles, Steps, TabBar, Tag, TxnList, WaveDivider,
} from '@/components';
import { color, space, text } from '@/theme';

// Development only: every component with the same content as its design-system preview.html, for side-by-side checks.
export default function Design() {
  if (!__DEV__) return <Redirect href="/" />;
  const section = (name: string) => <Text style={{ ...text.heading, color: color.ink, marginTop: space[5] }}>{name}</Text>;
  return (
    <Screen width={1080}>
      <Text role="heading" aria-level={1} style={{ ...text.title, color: color.ink }}>组件对照</Text>
      {section('Button')}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[4], alignItems: 'center' }}>
        <Button icon="deposit" label="存款" />
        <Button label="确认存款" />
        <Button variant="secondary" icon="query" label="查询余额" />
        <Button variant="ghost" label="返回" />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[4], alignItems: 'center' }}>
        <Button small label="知道了" />
        <Button small variant="secondary" icon="help" label="帮助" />
        <Button label="余额不足" disabled />
      </View>
      {section('ServiceTile')}
      <ServiceTiles>
        {([['deposit', '存款'], ['withdraw', '取款'], ['exchange', '兑换', '文创好物'], ['query', '查询'], ['invest', '理财', '活期转定期'],
          ['loan', '贷款'], ['passbook', '存折'], ['calendar', '预约']] as const).map(([icon, label, note]) => (
          <ServiceTile key={label} icon={icon} label={label} note={note} />
        ))}
      </ServiceTiles>
      {section('BalanceCard')}
      <View style={{ maxWidth: 440 }}>
        <BalanceCard amount={1280} split={[{ label: '活期', value: '480' }, { label: '定期', value: '800' }, { label: '利息', value: '+12' }]} />
      </View>
      {section('TxnList')}
      <View style={{ maxWidth: 480 }}>
        <TxnList items={[
          { key: '1', icon: 'deposit', title: '存款 · 活期', time: '10月27日 14:20', amount: 50, note: '存入' },
          { key: '2', icon: 'exchange', title: '兑换 · 海豚书签', time: '10月25日 12:05', amount: -20, note: '支出' },
          { key: '3', icon: 'star', title: '老师奖励 · 值日之星', time: '10月24日 16:40', amount: 10, note: '奖励' },
        ]} />
      </View>
      {section('Steps')}
      <View style={{ maxWidth: 560 }}><Steps steps={['选择业务', '输入金额', '核对信息', '完成']} current={1} /></View>
      {section('Field')}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[5] }}>
        <View style={{ flex: 1, minWidth: 260 }}>
          <Field label="存款金额" icon="coin" inputMode="numeric" placeholder="请输入金额" defaultValue="50" unit="HTB" hint="单笔最多存入 500 HTB" />
        </View>
        <View style={{ flex: 1, minWidth: 260 }}>
          <Field label="取款金额" icon="withdraw" inputMode="numeric" defaultValue="2000" unit="HTB" error="超出可用余额 1,280 HTB，请重新输入" />
        </View>
      </View>
      {section('Tag')}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[4] }}>
        <Tag icon="passbook" label="活期" />
        <Tag variant="success" icon="success" label="已到账" />
        <Tag variant="danger" icon="warning" label="已逾期" />
        <Tag variant="coin" icon="star" label="+10 闪光点" />
      </View>
      {section('Notice')}
      <View style={{ gap: space[3], maxWidth: 480 }}>
        <Notice variant="success" title="存款成功">50 HTB 已存入你的活期账户。</Notice>
        <Notice variant="danger" title="余额不足">可用余额 1,280 HTB，还差 720 HTB，请减少取款金额。</Notice>
        <Notice variant="coin" title="获得老师奖励">值日之星奖励 10 HTB 已到账，继续加油！</Notice>
      </View>
      {section('TabBar')}
      <View style={{ maxWidth: 420 }}>
        <TabBar current="/design" tabs={[{ href: '/design', icon: 'home', label: '首页' }, { href: '/design#2', icon: 'exchange', label: '兑换' },
          { href: '/design#3', icon: 'bell', label: '消息' }, { href: '/design#4', icon: 'me', label: '我的' }]} />
      </View>
      {section('GuideBubble')}
      <GuideBubble step={1} total={3}>点击「存款」可以把海豚币存入账户。选择定期存款，到期后按利率获得利息。</GuideBubble>
      {section('WaveDivider')}
      <WaveDivider />
    </Screen>
  );
}
