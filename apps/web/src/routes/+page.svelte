<script lang="ts">
  import { onMount } from 'svelte';
  import '../lib/tema.css';
  import '../lib/app.css';
  import { app } from '../lib/app.svelte.ts';
  import { nav } from '../lib/nav.svelte.ts';
  import { pwa } from '../lib/pwa.svelte.ts';
  import { session } from '../lib/session.svelte.ts';
  import AddPerson from '../lib/screens/AddPerson.svelte';
  import AdminHome from '../lib/screens/AdminHome.svelte';
  import Alert from '../lib/screens/Alert.svelte';
  import Audit from '../lib/screens/Audit.svelte';
  import Backups from '../lib/screens/Backups.svelte';
  import ChooseTheme from '../lib/screens/ChooseTheme.svelte';
  import District from '../lib/screens/District.svelte';
  import Districts from '../lib/screens/Districts.svelte';
  import Election from '../lib/screens/Election.svelte';
  import ElectionNew from '../lib/screens/ElectionNew.svelte';
  import Envelopes from '../lib/screens/Envelopes.svelte';
  import FiscalPlan from '../lib/screens/FiscalPlan.svelte';
  import Fiscales from '../lib/screens/Fiscales.svelte';
  import Home from '../lib/screens/Home.svelte';
  import InstallIphone from '../lib/screens/InstallIphone.svelte';
  import Invite from '../lib/screens/Invite.svelte';
  import LightCategories from '../lib/screens/LightCategories.svelte';
  import LightHome from '../lib/screens/LightHome.svelte';
  import More from '../lib/screens/More.svelte';
  import Numbers from '../lib/screens/Numbers.svelte';
  import Party from '../lib/screens/Party.svelte';
  import Persons from '../lib/screens/Persons.svelte';
  import Photo from '../lib/screens/Photo.svelte';
  import Review from '../lib/screens/Review.svelte';
  import Roll from '../lib/screens/Roll.svelte';
  import RollUpload from '../lib/screens/RollUpload.svelte';
  import Security from '../lib/screens/Security.svelte';
  import Settings from '../lib/screens/Settings.svelte';
  import TableDetail from '../lib/screens/TableDetail.svelte';
  import Tables from '../lib/screens/Tables.svelte';
  import Tally from '../lib/screens/Tally.svelte';
  import Team from '../lib/screens/Team.svelte';
  import Voted from '../lib/screens/Voted.svelte';

  const SCREENS: Record<string, any> = {
    home: Home, addPerson: AddPerson, adminHome: AdminHome, alert: Alert, audit: Audit, backups: Backups, chooseTheme: ChooseTheme, district: District, districts: Districts,
    election: Election, electionNew: ElectionNew, envelopes: Envelopes, fiscalPlan: FiscalPlan, fiscales: Fiscales, installIphone: InstallIphone, invite: Invite,
    lightCategories: LightCategories, lightHome: LightHome, more: More, numbers: Numbers, party: Party, persons: Persons, photo: Photo, review: Review, roll: Roll,
    rollUpload: RollUpload, security: Security, settings: Settings, tableDetail: TableDetail, tables: Tables, tally: Tally, team: Team, voted: Voted,
  };

  onMount(() => {
    pwa.start();
    void session.start();
  });

  // Also when someone gets in without reloading, by typing a code.
  $effect(() => {
    if (session.ready && (app.practice || session.can('fiscal'))) void app.start();
  });

  const Screen = $derived(SCREENS[nav.current.name] ?? Home);
</script>

{#key nav.current}
  <Screen {...nav.current.params} />
{/key}
