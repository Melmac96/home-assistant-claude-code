// my74: the starting Quick jobs and replies, shared by handover.js and savejob-cli.js
export const DEFAULT_QUICK = {
  jobs: [
    { label: 'Check notes', text: 'Check notes' },
    { label: 'Full HA check', text: 'Full HA check' },
    { label: 'Weekly checks', text: 'Do the weekly checks' },
    { label: 'Overnight?', text: 'What happened overnight? Tell me only what needs me.' },
    { label: 'Refresh screens', text: 'Refresh my screens' },
  ],
  replies: ['Yes please', 'Continue', 'Finished', 'All confirmed', 'It works, thank you', "Not right, here's a picture", 'Explain that more simply', 'Show the question again'],
};
